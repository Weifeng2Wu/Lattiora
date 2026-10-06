import { describe, expect, it, vi } from "vitest";
import { preferredModeForPath } from "@/lib/workspace/viewer";
import { VisualDocumentSave } from "@/lib/workspace/visual-document-save";
import {
	branchIds,
	type Kanban,
	layoutMindMap,
	type MindMap,
	moveKanbanCard,
	parseVisualDocument,
} from "@/lib/workspace/visual-documents";

const map: MindMap = {
	type: "mindmap",
	version: 1,
	nodes: [
		{ id: "root", parentId: null, text: "Research" },
		{ id: "a", parentId: "root", text: "Method" },
		{ id: "b", parentId: "root", text: "Evaluation" },
		{ id: "c", parentId: "a", text: "Baseline" },
	],
};
const board: Kanban = {
	type: "kanban",
	version: 1,
	columns: [
		{
			id: "todo",
			title: "To do",
			cards: [
				{ id: "a", title: "Read", description: "Paper" },
				{ id: "b", title: "Run", description: "Experiment" },
			],
		},
		{ id: "done", title: "Done", cards: [] },
	],
};

describe("visual documents", () => {
	it("opens visual JSON as a text-backed editor including paper folders", () => {
		expect(preferredModeForPath("/vault/papers/id/plan.mindmap.json")).toBe(
			"text",
		);
		expect(preferredModeForPath("/vault/notes/plan.KANBAN.JSON")).toBe("text");
	});
	it("rejects cycles, missing parents, duplicate IDs and future versions without losing fields", () => {
		const parse = (value: unknown) =>
			parseVisualDocument(JSON.stringify(value), "mindmap");
		expect(parse(map)).toEqual(map);
		expect(() => parse({ ...map, version: 2 })).toThrow();
		expect(() => parse({ ...map, extra: true })).toThrow();
		expect(() =>
			parse({ ...map, nodes: [...map.nodes, map.nodes[0]] }),
		).toThrow();
		expect(() =>
			parse({
				...map,
				nodes: map.nodes.map((n) =>
					n.id === "a" ? { ...n, parentId: "c" } : n,
				),
			}),
		).toThrow();
		expect(() =>
			parse({
				...map,
				nodes: map.nodes.map((n) =>
					n.id === "a" ? { ...n, parentId: "missing" } : n,
				),
			}),
		).toThrow();
		expect(() =>
			parseVisualDocument(
				JSON.stringify({
					...board,
					columns: [...board.columns, board.columns[0]],
				}),
				"kanban",
			),
		).toThrow();
	});
	it("collapses only visible layout and preserves descendant content", () => {
		expect(branchIds(map, "a")).toEqual(new Set(["a", "c"]));
		const collapsed = {
			...map,
			nodes: map.nodes.map((n) =>
				n.id === "a" ? { ...n, collapsed: true } : n,
			),
		};
		expect(layoutMindMap(collapsed).positions.map((p) => p.node.id)).toEqual([
			"root",
			"a",
			"b",
		]);
		const expanded = layoutMindMap(map);
		expect(expanded.positions.map((p) => p.node.id)).toContain("c");
		expect(expanded.positions.find((p) => p.node.id === "a")?.y).not.toBe(
			expanded.positions.find((p) => p.node.id === "b")?.y,
		);
	});
	it("persists branch color and moves descendants with their parent offset", () => {
		const moved: MindMap = {
			...map,
			nodes: map.nodes.map((node) =>
				node.id === "a"
					? { ...node, color: "#ff0000", offset: { x: -80, y: 50 } }
					: node,
			),
		};
		expect(parseVisualDocument(JSON.stringify(moved), "mindmap")).toEqual(
			moved,
		);
		const before = layoutMindMap(map).positions;
		const after = layoutMindMap(moved).positions;
		for (const entry of after) {
			const original = before.find((p) => p.node.id === entry.node.id);
			if (!original) throw new Error("Missing original position");
			const moving = entry.node.id === "a" || entry.node.id === "c";
			expect(entry.x - original.x).toBe(moving ? -80 : 0);
			expect(entry.y - original.y).toBe(moving ? 50 : 0);
		}
		for (const changes of [
			{ color: "url(https://example.com)" },
			{ offset: { x: 100001, y: 0 } },
		]) {
			expect(() =>
				parseVisualDocument(
					JSON.stringify({
						...map,
						nodes: map.nodes.map((node) => ({ ...node, ...changes })),
					}),
					"mindmap",
				),
			).toThrow();
		}
	});
	it("moves and reorders cards without duplicating or changing their content", () => {
		const reordered = moveKanbanCard(board, "b", "todo", "a");
		expect(reordered.columns[0].cards.map((c) => c.id)).toEqual(["b", "a"]);
		const moved = moveKanbanCard(reordered, "a", "done");
		expect(moved.columns[0].cards.map((c) => c.id)).toEqual(["b"]);
		expect(moved.columns[1].cards).toEqual([board.columns[0].cards[0]]);
		expect(moveKanbanCard(board, "a", "unknown")).toBe(board);
		expect(moveKanbanCard(board, "a", "todo", "a")).toBe(board);
	});
});

describe("visual document persistence", () => {
	it("serializes edits made during a save against the acknowledged version", async () => {
		let finish = (_ok: boolean) => {};
		const persist = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<boolean>((resolve) => {
						finish = resolve;
					}),
			)
			.mockResolvedValue(true);
		const dirty = vi.fn();
		const writer = new VisualDocumentSave("initial", persist, dirty);
		writer.change("first");
		const saving = writer.flush();
		writer.change("latest");
		expect(writer.flush()).toBe(saving);
		finish(true);
		expect(await saving).toBe(true);
		expect(persist.mock.calls).toEqual([
			["first", "initial"],
			["latest", "first"],
		]);
		expect(writer.isDirty).toBe(false);
		expect(dirty).toHaveBeenLastCalledWith(false);
	});
	it("retains failed edits for retry with the original expected content", async () => {
		const persist = vi
			.fn()
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);
		const writer = new VisualDocumentSave("initial", persist, vi.fn());
		writer.change("edit");
		expect(await writer.flush()).toBe(false);
		expect(writer.isDirty).toBe(true);
		expect(await writer.flush()).toBe(true);
		expect(persist.mock.calls).toEqual([
			["edit", "initial"],
			["edit", "initial"],
		]);
	});
	it("discards pending stale edits when the user accepts an external reload", async () => {
		let finish = (_ok: boolean) => {};
		const persist = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<boolean>((resolve) => {
						finish = resolve;
					}),
			)
			.mockResolvedValue(true);
		const writer = new VisualDocumentSave("initial", persist, vi.fn());
		writer.change("old");
		const saving = writer.flush();
		writer.change("stale");
		writer.reset("external");
		finish(false);
		await saving;
		writer.change("new edit");
		await writer.flush();
		expect(persist.mock.calls).toEqual([
			["old", "initial"],
			["new edit", "external"],
		]);
	});
});
