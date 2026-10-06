import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../src/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("../src/lib/cloud/coolpapers", () => ({
	coolPaperUrl: (branch: string, id: string) =>
		`https://papers.cool/${branch}/${encodeURIComponent(id)}`,
}));
vi.mock("../src/lib/cloud/html-reader", () => ({ loadHtmlPage: vi.fn() }));
beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubGlobal("navigator", {
		locks: { request: (_key: string, fn: () => unknown) => fn() },
	});
});
afterEach(() => vi.unstubAllGlobals());
const analysis = {
	url: "https://papers.cool/venue/123%40AAAI",
	markdown: "## Q1: What?\n\n### Answer\n\nPreserve $x+y$ and **Markdown**.",
};
it("appends without rewriting user notes, and repeated retrieval is idempotent", async () => {
	const { writeLocalFile, readLocalFile } = await import(
		"../src/lib/cloud/files"
	);
	const { appendCoolAnalysis } = await import(
		"../src/lib/cloud/coolpapers-notes"
	);
	await writeLocalFile(
		"papers/test/NOTES.md",
		new Blob(["# My notes\n\nKeep my work.\n"]),
	);
	expect(await appendCoolAnalysis("papers/test", analysis)).toBe(true);
	const saved = await (await readLocalFile("papers/test/NOTES.md")).text();
	expect(saved).toMatch(/^# My notes\n\nKeep my work\./);
	expect(saved).toContain(analysis.markdown);
	expect(await appendCoolAnalysis("papers/test", analysis)).toBe(false);
	expect(await (await readLocalFile("papers/test/NOTES.md")).text()).toBe(
		saved,
	);
});
it("checks the editor guard inside the local transaction and preserves content on cancellation", async () => {
	const { writeLocalFile, readLocalFile } = await import(
		"../src/lib/cloud/files"
	);
	const { appendCoolAnalysis } = await import(
		"../src/lib/cloud/coolpapers-notes"
	);
	await writeLocalFile(
		"papers/test/NOTES.md",
		new Blob(["Unsaved editor must win"]),
	);
	await expect(
		appendCoolAnalysis("papers/test", analysis, {
			guard: () => {
				throw new Error("dirtyDocument");
			},
		}),
	).rejects.toThrow("dirtyDocument");
	const controller = new AbortController();
	controller.abort();
	await expect(
		appendCoolAnalysis("papers/test", analysis, { signal: controller.signal }),
	).rejects.toThrow();
	expect(await (await readLocalFile("papers/test/NOTES.md")).text()).toBe(
		"Unsaved editor must win",
	);
});
it("recognizes original page/FAQ URLs, venue IDs and versionless arXiv IDs", async () => {
	const { coolPaperReference } = await import(
		"../src/lib/cloud/coolpapers-notes"
	);
	expect(
		coolPaperReference({
			id: "x",
			source_url: "https://papers.cool/venue/kimi?paper=38818%40AAAI",
		}),
	).toEqual({ branch: "venue", id: "38818@AAAI" });
	expect(coolPaperReference({ id: "38818@AAAI" })).toEqual({
		branch: "venue",
		id: "38818@AAAI",
	});
	expect(coolPaperReference({ id: "x", arxiv_id: "1706.03762v7" })).toEqual({
		branch: "arxiv",
		id: "1706.03762",
	});
	expect(
		coolPaperReference({
			id: "x",
			source_url: "https://papers.cool.evil.example/venue/123",
		}),
	).toBeNull();
});
it("only exposes the long analysis timeout to the fixed public Kimi route", async () => {
	const { feedRoutes } = await import("../cloudflare/feeds");
	const fetcher = vi.fn(
		async () =>
			new Response("FAQ", { headers: { "content-type": "text/plain" } }),
	);
	vi.stubGlobal("fetch", fetcher);
	const request = (url: string) =>
		new Request("https://app.example/api/coolpapers/analysis", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ url }),
		});
	await expect(
		feedRoutes(request("https://other.example/arxiv/kimi?paper=1706.03762")),
	).rejects.toThrow("feeds.invalid_url");
	expect(fetcher).not.toHaveBeenCalled();
	const response = await feedRoutes(
		request("https://papers.cool/arxiv/kimi?paper=1706.03762"),
	);
	expect(await response?.json()).toMatchObject({ body: "FAQ", status: 200 });
});
