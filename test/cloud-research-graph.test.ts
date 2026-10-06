import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../src/lib/settings", () => ({ loadSettings: () => ({}) }));
beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubGlobal("navigator", {
		locks: { request: (_: string, run: () => unknown) => run() },
	});
});
afterEach(() => vi.unstubAllGlobals());
it("collapses paper assets, resolves actual links, excludes ambiguous/hidden links and refreshes citations against the library", async () => {
	const { writeLocalFile } = await import("../src/lib/cloud/files");
	const write = (path: string, text: string) =>
		writeLocalFile(path, new Blob([text]));
	for (const [id, title] of [
		["a", "First paper"],
		["b", "Second paper"],
	])
		await write(
			`papers/${id}/.paper.json`,
			JSON.stringify({
				id,
				path: `papers/${id}`,
				title,
				doi: `10.1234/${id}`,
				added_at: "2026-10-01",
				authors: [],
				tags: [],
			}),
		);
	await write(
		"papers/a/NOTES.md",
		"# First paper\n[[notes/topic]] [[notes/topic]]\n[[papers/a/PAPER]]\n[[ambiguous]]\n`[[notes/code]]`",
	);
	await write("papers/a/PAPER.md", "# Text");
	await write(
		"notes/topic.md",
		"# Topic\n[[papers/b/NOTES]]\n[[.agentero/private]]",
	);
	await write("papers/b/NOTES.md", "# Second paper");
	await write("notes/x/ambiguous.md", "");
	await write("notes/y/ambiguous.md", "");
	await write("notes/code.md", "");
	await write(".agentero/private.md", "");
	await write("Conflicts/notes/hidden.md", "");
	await write(
		"papers/a/source/agentero-cite.json",
		JSON.stringify({
			schemaVersion: 1,
			citations: [
				{
					id: "b",
					metadata: { doi: "10.1234/b" },
					localMatch: { paperPath: "papers/stale" },
				},
			],
		}),
	);
	const { loadResearchGraph } = await import("../src/lib/cloud/graph");
	const graph = await loadResearchGraph();
	expect(graph.nodes.filter((n) => n.kind === "paper")).toHaveLength(2);
	expect(
		graph.nodes.some(
			(n) =>
				n.id.includes("NOTES") ||
				n.id.includes("Conflicts") ||
				n.id.includes("private"),
		),
	).toBe(false);
	expect(graph.edges).toEqual(
		expect.arrayContaining([
			{ source: "papers/a", target: "notes/topic.md", kind: "link" },
			{ source: "notes/topic.md", target: "papers/b", kind: "link" },
			{ source: "papers/a", target: "papers/b", kind: "citation" },
		]),
	);
	expect(graph.edges).toHaveLength(3);
	await write("notes/topic.md", "# Topic");
	expect((await loadResearchGraph()).edges).toHaveLength(2);
});
it("keeps filtered nodes reachable beyond the global rendering limit and includes immediate neighbors", async () => {
	const { filterGraph, layoutGraph } = await import("../src/lib/graph/model");
	const graph = {
		nodes: Array.from({ length: 350 }, (_, i) => ({
			id: `n${i}`,
			title: `Node ${i}`,
			kind: "note" as const,
		})),
		edges: [{ source: "n349", target: "n1", kind: "link" as const }],
		unavailable: 0,
	};
	const view = filterGraph(graph, {
		query: "Node 349",
		focus: null,
		links: true,
		citations: true,
	});
	expect(view.nodes.map((n) => n.id)).toEqual(["n1", "n349"]);
	expect(view.edges).toHaveLength(1);
	expect(layoutGraph(view.nodes, view.edges)).toEqual(
		layoutGraph(view.nodes, view.edges),
	);
});
