import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let embedding = {
	baseUrl: "https://embedding.test/v1",
	model: "test",
	apiKey: "********",
};
vi.mock("../src/lib/settings", () => ({ loadSettings: () => ({ embedding }) }));
beforeEach(() => {
	vi.resetModules();
	embedding = {
		baseUrl: "https://embedding.test/v1",
		model: "test",
		apiKey: "********",
	};
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubGlobal("navigator", {
		onLine: true,
		locks: { request: (_: string, run: () => unknown) => run() },
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: string, init: RequestInit) =>
			Response.json({
				vectors: JSON.parse(String(init.body)).input.map((text: string) =>
					/visual|image/i.test(text) ? [1, 0] : [0, 1],
				),
			}),
		),
	);
});
afterEach(() => vi.unstubAllGlobals());
it("indexes all saved text, reuses vectors, retrieves semantic matches and excludes changed/deleted sources and old models", async () => {
	const f = await import("../src/lib/cloud/files");
	const search = await import("../src/lib/cloud/semantic-search");
	const db = await import("../src/lib/cloud/db");
	for (const [path, text] of [
		["notes/a.md", "Visual representation learning"],
		["notes/b.md", "Language syntax"],
		[".agentero/secret.md", "Visual private"],
		["Conflicts/a.md", "Visual conflict"],
	])
		await f.writeLocalFile(path, new Blob([text]));
	const signal = new AbortController().signal;
	expect(await search.buildSemanticIndex(signal, () => {})).toEqual([]);
	expect(await search.semanticIndexStatus()).toMatchObject({
		indexed: 2,
		total: 2,
	});
	expect(fetch).toHaveBeenCalledTimes(2);
	await search.buildSemanticIndex(signal, () => {});
	expect(fetch).toHaveBeenCalledTimes(2);
	expect(
		(await search.searchSemantic("image", signal)).map((hit) => hit.path),
	).toEqual(["notes/a.md"]);
	const requests = vi.mocked(fetch).mock.calls.length;
	await search.searchSemantic("image", signal);
	expect(fetch).toHaveBeenCalledTimes(requests);
	await f.writeLocalFile("notes/a.md", new Blob(["Updated visual result"]));
	expect(await search.searchSemantic("image", signal)).toEqual([]);
	expect(await search.semanticIndexStatus()).toMatchObject({
		indexed: 1,
		total: 2,
	});
	await search.buildSemanticIndex(signal, () => {});
	await db.localTransaction((files) => {
		const file = files.get("notes/a.md")!;
		files.set(file.path, { ...file, deleted: 1 });
	});
	expect(await search.searchSemantic("image", signal)).toEqual([]);
	embedding = { ...embedding, model: "new-model" };
	expect(await search.semanticIndexStatus()).toMatchObject({ indexed: 0 });
	await expect(search.searchSemantic("image", signal)).rejects.toThrow(
		"semanticIndexMissing",
	);
});
it("never commits an index for a source changed while embedding and resumes completed work after cancellation", async () => {
	const f = await import("../src/lib/cloud/files");
	const search = await import("../src/lib/cloud/semantic-search");
	await f.writeLocalFile("notes/a.md", new Blob(["Visual paper"]));
	vi.mocked(fetch).mockImplementationOnce(async () => {
		await f.writeLocalFile("notes/a.md", new Blob(["Changed visual paper"]));
		return Response.json({ vectors: [[1, 0]] });
	});
	const failures = await search.buildSemanticIndex(
		new AbortController().signal,
		() => {},
	);
	expect(failures[0].error).toBe("localConflict");
	expect((await search.semanticIndexStatus()).indexed).toBe(0);
	const controller = new AbortController();
	controller.abort();
	await expect(
		search.buildSemanticIndex(controller.signal, () => {}),
	).rejects.toThrow();
	expect(
		await search.buildSemanticIndex(new AbortController().signal, () => {}),
	).toEqual([]);
	expect((await search.semanticIndexStatus()).indexed).toBe(1);
});
it("preserves every section and PDF page across chunk boundaries", async () => {
	const { chunkSemanticText } = await import(
		"../src/lib/cloud/semantic-search"
	);
	const text = `<!-- page 1 -->\n${"first ".repeat(500)}\n<!-- page 2 -->\n${"second ".repeat(500)}`;
	const chunks = chunkSemanticText(text);
	expect(chunks.length).toBeGreaterThan(2);
	expect(
		chunks.filter((c) => c.page === 1).every((c) => !c.text.includes("second")),
	).toBe(true);
	expect(
		chunks.filter((c) => c.page === 2).some((c) => c.text.includes("second")),
	).toBe(true);
	expect(chunks.every((c) => c.text.length <= 1800)).toBe(true);
});

it("rebuilds missing and corrupt vectors instead of leaving a source permanently unsearchable", async () => {
	const f = await import("../src/lib/cloud/files");
	const search = await import("../src/lib/cloud/semantic-search");
	await f.writeLocalFile("notes/repair.md", new Blob(["Visual results"]));
	const signal = new AbortController().signal;
	await search.buildSemanticIndex(signal, () => {});
	const vector = (await f.listLocalFiles()).find((file) =>
		file.path.startsWith(".agentero/recommend/vectors/"),
	)!;
	await f.writeLocalFile(vector.path, new Blob(["invalid JSON"]));
	expect((await search.semanticIndexStatus()).indexed).toBe(0);
	expect(await search.buildSemanticIndex(signal, () => {})).toEqual([]);
	expect((await search.searchSemantic("image", signal))[0]?.path).toBe(
		"notes/repair.md",
	);
});
