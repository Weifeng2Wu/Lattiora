import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	recognitionHit,
	recognitionPayload,
} from "../src/lib/cloud/recognition-protocol";

const state = vi.hoisted(() => ({
	config: {
		baseUrl: "https://recognizer.example/recognize",
		apiKey: "",
		enabled: true,
	},
	cancel: false,
}));
vi.mock("../src/lib/settings", () => ({
	loadSettings: () => ({ recognizer: state.config }),
	subscribeSettings: () => () => {},
}));
vi.mock("../src/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("../src/lib/core/notify", () => ({ notifyError: vi.fn() }));
vi.mock("../src/lib/core/tasks", () => ({
	runLocalActivity: async (
		_: unknown,
		fn: (c: { signal: AbortSignal }) => Promise<void>,
	) => {
		const controller = new AbortController();
		if (state.cancel) controller.abort();
		return fn({ signal: controller.signal });
	},
}));
vi.mock("../src/lib/core/background-tasks", () => ({
	isBackgroundTaskCancelledError: (e: Error) => e.name === "AbortError",
}));
vi.mock("../src/lib/pdf/layout/headless-analyze", () => ({
	getHeadlessPdfEngine: vi.fn(),
}));
vi.mock("../src/lib/cloud/recognition-extract", () => ({
	extractRecognitionPayload: async () => ({
		metadata: {},
		totalPages: 1,
		fileName: "paper.pdf",
		pages: [],
	}),
}));
beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("indexedDB", new IDBFactory());
	const locks = new Map<string, Promise<unknown>>();
	vi.stubGlobal("navigator", {
		onLine: true,
		locks: {
			request: (key: string, fn: () => Promise<unknown>) => {
				const next = (locks.get(key) ?? Promise.resolve())
					.catch(() => {})
					.then(fn);
				locks.set(key, next);
				return next;
			},
		},
	});
	state.cancel = false;
	state.config.enabled = true;
	state.config.baseUrl = "https://recognizer.example/recognize";
});
afterEach(() => vi.unstubAllGlobals());
async function setup() {
	const files = await import("../src/lib/cloud/files");
	const catalog = await import("../src/lib/cloud/catalog");
	const queue = await import("../src/lib/cloud/recognition");
	const paper = {
		id: "test",
		path: "papers/test",
		title: "Draft",
		meta_source: "filename",
		authors: [],
		added_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
	};
	const blob = new Blob(["%PDF test"]);
	await files.writeLocalFile(
		"papers/test/.paper.json",
		new Blob([JSON.stringify(paper)]),
	);
	await files.writeLocalFile(
		"papers/test/NOTES.md",
		new Blob(["# Draft\n\nMy notes."]),
	);
	await files.writeLocalFile("papers/test/paper.pdf", blob);
	await queue.enqueuePdfRecognition(paper as never, blob);
	return { files, catalog, queue };
}
it("waits offline and without configuration; resumes with guarded note and metadata update", async () => {
	const { files, queue } = await setup();
	const fetcher = vi.fn(async () =>
		Response.json({ title: "Recognized paper", authors: [] }),
	);
	vi.stubGlobal("fetch", fetcher);
	navigator.onLine = false as never;
	await queue.processRecognitionQueue();
	expect(fetcher).not.toHaveBeenCalled();
	navigator.onLine = true as never;
	state.config.enabled = false;
	await queue.processRecognitionQueue();
	expect(fetcher).not.toHaveBeenCalled();
	state.config.enabled = true;
	await queue.processRecognitionQueue();
	expect((await queue.listRecognitionJobs())[0].job.state).toBe("done");
	expect(
		await (await files.readLocalFile("papers/test/NOTES.md")).text(),
	).toContain("# Recognized paper");
	await queue.processRecognitionQueue();
	expect(fetcher).toHaveBeenCalledTimes(1);
});
it("retains manual metadata and replaced PDFs without a provider call", async () => {
	const { files, queue, catalog } = await setup();
	const fetcher = vi.fn();
	vi.stubGlobal("fetch", fetcher);
	await catalog.updateCloudPaper("papers/test", { title: "Human title" });
	await queue.processRecognitionQueue();
	expect((await queue.listRecognitionJobs())[0].job.state).toBe("skipped");
	expect(fetcher).not.toHaveBeenCalled();
	expect(
		await (await files.readLocalFile("papers/test/NOTES.md")).text(),
	).toContain("Human title");
});
it("rejects a PDF replaced while recognition is in flight and keeps user data", async () => {
	const { files, queue } = await setup();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			await files.writeLocalFile(
				"papers/test/paper.pdf",
				new Blob(["%PDF replacement"]),
			);
			return Response.json({ title: "Stale result", authors: [] });
		}),
	);
	await queue.processRecognitionQueue();
	expect((await queue.listRecognitionJobs())[0].job).toMatchObject({
		state: "failed",
		error: "metadataChanged",
	});
	expect(
		JSON.parse(
			await (await files.readLocalFile("papers/test/.paper.json")).text(),
		).title,
	).toBe("Draft");
});
it("persists failures with backoff and explicit retry resets the queue", async () => {
	const { queue } = await setup();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			Response.json({ error: "providerUnavailable" }, { status: 502 }),
		),
	);
	await queue.processRecognitionQueue();
	const row = (await queue.listRecognitionJobs())[0];
	expect(row.job).toMatchObject({
		state: "pending",
		attempts: 1,
		error: "providerUnavailable",
	});
	expect(row.job.nextAttempt).toBeGreaterThan(Date.now());
	const { writeLocalFile } = await import("../src/lib/cloud/files");
	await writeLocalFile(
		row.path,
		new Blob([JSON.stringify({ ...row.job, state: "failed" })]),
	);
	await queue.retryRecognitionJobs();
	expect((await queue.listRecognitionJobs())[0].job).toMatchObject({
		state: "pending",
		attempts: 0,
		nextAttempt: 0,
	});
});
it("preserves Zotero lines, segments and words when extracting recognition geometry", async () => {
	const { recognitionPage } = await vi.importActual<
		typeof import("../src/lib/cloud/recognition-extract")
	>("../src/lib/cloud/recognition-extract");
	const page = recognitionPage(612, 792, [
		{
			text: "arXiv:1706.03762",
			fontSize: 18,
			rect: { origin: { x: 72, y: 74 }, size: { width: 328, height: 18 } },
		},
	] as never);
	const word = [
		72,
		700,
		400,
		718,
		18,
		1,
		700,
		0,
		0,
		0,
		0,
		0,
		0,
		"arXiv:1706.03762",
	];
	expect(page[2][0][0][0][4]).toEqual([[[word]]]);
	const payload = {
		metadata: {},
		totalPages: 1,
		fileName: "a.pdf",
		pages: [page],
	};
	expect(recognitionPayload.safeParse(payload).success).toBe(true);
	const malformed = structuredClone(payload);
	(malformed.pages[0][2][0][0][0] as unknown[])[4] = [[word]];
	expect(recognitionPayload.safeParse(malformed).success).toBe(false);
	expect(recognitionHit.safeParse({}).success).toBe(false);
});
it("uses the default public recognizer without forwarding custom credentials", async () => {
	const { recognitionRoutes } = await import("../cloudflare/recognition");
	vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
		expect(String(url)).toBe(
			"https://services.zotero.org/recognizer/recognize",
		);
		expect(new Headers(init.headers).has("authorization")).toBe(false);
		const payload = JSON.parse(String(init.body));
		expect(recognitionPayload.safeParse(payload).success).toBe(true);
		expect(payload.pages[0][2][0][0][0][4][0][0][0][13]).toBe(
			"arXiv:1706.03762",
		);
		return Response.json({ arxiv: "1706.03762" });
	});
	const response = await recognitionRoutes(
		new Request("https://app.example/api/recognize", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ operation: "probe", apiKey: "old-custom-key" }),
		}),
		{} as never,
	);
	expect(await response?.json()).toMatchObject({ ok: true });
});

it("forwards the configured recognition protocol with credentials and rejects redirect/empty replies", async () => {
	const { recognitionRoutes } = await import("../cloudflare/recognition");
	const sent: Array<{ url: string; init: RequestInit }> = [];
	vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
		sent.push({ url: String(url), init });
		return Response.json({ title: "Attention Is All You Need" });
	});
	const request = () =>
		new Request("https://app.example/api/recognize", {
			headers: { "content-type": "application/json" },
			method: "POST",
			body: JSON.stringify({
				operation: "probe",
				baseUrl: "https://recognizer.example/custom",
				apiKey: "test-secret",
			}),
		});
	const result = await recognitionRoutes(request(), {} as never);
	expect(await result?.json()).toMatchObject({ ok: true });
	expect(sent[0].url).toBe("https://recognizer.example/custom");
	expect(sent[0].init.redirect).toBe("manual");
	expect(sent[0].init.headers).toMatchObject({
		authorization: "Bearer test-secret",
	});
	expect(
		recognitionPayload.safeParse(JSON.parse(String(sent[0].init.body))).success,
	).toBe(true);
	vi.stubGlobal(
		"fetch",
		async () =>
			new Response(null, {
				status: 302,
				headers: { location: "https://other.example" },
			}),
	);
	await expect(recognitionRoutes(request(), {} as never)).rejects.toThrow(
		"providerError",
	);
	vi.stubGlobal("fetch", async () => Response.json({}));
	await expect(recognitionRoutes(request(), {} as never)).rejects.toThrow(
		"invalidProviderResponse",
	);
});
it("normalizes recognized identifiers with original folder naming and repairs links atomically", async () => {
	const { files, catalog } = await setup();
	await catalog.updateCloudPaper(
		"papers/test",
		{ arxivId: "1706.03762" },
		{ metaSource: "recognizer" },
	);
	await files.writeLocalFile(
		"notes/reference.md",
		new Blob(["[[papers/test/NOTES|my notes]]"]),
	);
	const { organizeRecognizedPaper, recognitionCanonicalStem } = await import(
		"../src/lib/cloud/recognition-organize"
	);
	expect(recognitionCanonicalStem({ doi: "10.1234/example" })).toBe(
		"10_1234_example",
	);
	const result = await organizeRecognizedPaper("papers/test");
	expect(result.path).toBe("papers/1706.03762");
	expect((await catalog.getCloudPaper(result.path)).path).toBe(result.path);
	expect(
		await (await files.readLocalFile("notes/reference.md")).text(),
	).toContain("papers/1706.03762/NOTES|my notes");
	await expect(files.readLocalFile("papers/test/NOTES.md")).rejects.toThrow();
});
it("merges a duplicate by archiving every imported resource and keeping the main paper and both notes", async () => {
	const { files, catalog } = await setup();
	await catalog.updateCloudPaper(
		"papers/test",
		{ doi: "10.1234/example" },
		{ metaSource: "recognizer" },
	);
	await files.writeLocalFile(
		"papers/main/.paper.json",
		new Blob([
			JSON.stringify({
				id: "main",
				path: "papers/main",
				title: "My main title",
				doi: "10.1234/example",
				added_at: "2020-01-01T00:00:00Z",
			}),
		]),
	);
	await files.writeLocalFile(
		"papers/main/NOTES.md",
		new Blob(["My main notes"]),
	);
	await files.writeLocalFile(
		"papers/test/source/data.csv",
		new Blob(["Original experiment"]),
	);
	const { organizeRecognizedPaper } = await import(
		"../src/lib/cloud/recognition-organize"
	);
	const result = await organizeRecognizedPaper("papers/test");
	expect(result.archived).toBe(true);
	expect(result.path).toMatch(/^papers\/main\/attachments\/import-/);
	expect(
		await (await files.readLocalFile(`${result.path}/NOTES.md`)).text(),
	).toContain("My notes.");
	expect(
		await (await files.readLocalFile(`${result.path}/source/data.csv`)).text(),
	).toBe("Original experiment");
	expect(await (await files.readLocalFile("papers/main/NOTES.md")).text()).toBe(
		"My main notes",
	);
	expect((await catalog.listCloudPapers()).map((p) => p.title)).toEqual([
		"My main title",
	]);
	expect(
		await (
			await files.readLocalFile(`${result.path}/import-metadata.json`)
		).text(),
	).toContain('"test"');
});
it("does not move unsaved source editors or overwrite canonical destinations", async () => {
	const { files, catalog } = await setup();
	await catalog.updateCloudPaper(
		"papers/test",
		{ arxivId: "1706.03762" },
		{ metaSource: "recognizer" },
	);
	const { organizeRecognizedPaper } = await import(
		"../src/lib/cloud/recognition-organize"
	);
	await expect(
		organizeRecognizedPaper("papers/test", [
			"/cloud/papers/test/source/main.tex",
		]),
	).rejects.toThrow("dirtyDocument");
	await files.writeLocalFile(
		"papers/1706.03762/keep.txt",
		new Blob(["User file"]),
	);
	await expect(organizeRecognizedPaper("papers/test")).rejects.toThrow(
		"pathExists",
	);
	expect(
		await (await files.readLocalFile("papers/test/paper.pdf")).text(),
	).toBe("%PDF test");
	expect(
		await (await files.readLocalFile("papers/1706.03762/keep.txt")).text(),
	).toBe("User file");
});
it("waits when a synced job arrives before its PDF, then processes it without losing the task", async () => {
	const { files, queue } = await setup();
	const blob = await files.readLocalFile("papers/test/paper.pdf");
	await files.removeLocal("papers/test/paper.pdf");
	const fetcher = vi.fn(async () =>
		Response.json({ title: "Ready after sync", authors: [] }),
	);
	vi.stubGlobal("fetch", fetcher);
	await queue.processRecognitionQueue();
	expect(fetcher).not.toHaveBeenCalled();
	expect((await queue.listRecognitionJobs())[0].job.state).toBe("pending");
	await files.writeLocalFile("papers/test/paper.pdf", blob);
	await queue.processRecognitionQueue();
	expect((await queue.listRecognitionJobs())[0].job.state).toBe("done");
});
it("commits rename and durable completion together; a stale completion leaves the entire source untouched", async () => {
	const { files, catalog, queue } = await setup();
	await catalog.updateCloudPaper(
		"papers/test",
		{ arxivId: "1706.03762" },
		{ metaSource: "recognizer" },
	);
	const row = (await queue.listRecognitionJobs())[0];
	const before = await (await files.readLocalFile(row.path)).text();
	const { organizeRecognizedPaper } = await import(
		"../src/lib/cloud/recognition-organize"
	);
	await expect(
		organizeRecognizedPaper("papers/test", [], undefined, {
			path: row.path,
			localId: "stale",
			before,
			content: () => "{}",
		}),
	).rejects.toThrow("localConflict");
	expect((await catalog.getCloudPaper("papers/test")).path).toBe("papers/test");
	await organizeRecognizedPaper("papers/test", [], undefined, {
		path: row.path,
		localId: row.localId,
		before,
		content: (destination) =>
			JSON.stringify({ ...row.job, path: destination, state: "done" }),
	});
	expect((await queue.listRecognitionJobs())[0].job).toMatchObject({
		path: "papers/1706.03762",
		state: "done",
	});
});
