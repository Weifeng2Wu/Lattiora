import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { clean } = vi.hoisted(() => ({ clean: vi.fn(async () => {}) }));
vi.mock("../src/lib/cloud/agent-edits", () => ({
	assertAgentDocumentClean: clean,
}));
beforeEach(() => {
	vi.resetModules();
	clean.mockReset();
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubGlobal("navigator", {
		locks: { request: (_name: string, run: () => unknown) => run() },
	});
});
afterEach(() => vi.unstubAllGlobals());

it("shows actual boards and notes while excluding hidden, deleted and conflict files", async () => {
	const home = await import("../src/lib/cloud/home");
	const f = await import("../src/lib/cloud/files");
	const path = await home.createHomeBoard("First task", [
		"待办",
		"进行中",
		"已完成",
	]);
	await home.createHomeBoard("Second task", ["Inbox", "Review", "Done"]);
	const board = await f.readLocalFile(path);
	for (const prefix of ["Conflicts/test", ".agentero/conflict-history/test"])
		await f.writeLocalFile(`${prefix}/${path}`, board);
	for (const path of [
		"notes/a.md",
		"notes/Conflicts/ordinary.md",
		"Conflicts/test/a.md",
		".agentero/a.md",
	])
		await f.writeLocalFile(path, new Blob(["Note"]));
	await f.writeLocalFile("notes/broken.kanban.json", new Blob(["{}"]));
	const result = await home.loadHomeOverview();
	expect(result.notes).toBe(2);
	expect(result.boards).toHaveLength(2);
	expect(result.unavailable).toBe(1);
	const first = result.boards.find((board) => board.path === path)!;
	expect(home.homeDoneColumn(first.doc)?.title).toBe("已完成");
	expect(home.homeDoneColumn(first.doc, first.doc.columns[1].id)?.title).toBe(
		"进行中",
	);
	expect(home.homeDoneColumn(first.doc, "deleted-column")).toBeNull();
	expect(
		home.homeDoneColumn({
			...first.doc,
			columns: first.doc.columns.map((column) => ({
				...column,
				title: "Custom",
			})),
		}),
	).toBeNull();
});

it("saves tasks into the source board and refuses stale or unsaved editor snapshots", async () => {
	const home = await import("../src/lib/cloud/home");
	const f = await import("../src/lib/cloud/files");
	const { moveKanbanCard } = await import(
		"../src/lib/workspace/visual-documents"
	);
	const path = await home.createHomeBoard("Write experiment", [
		"To do",
		"Done",
	]);
	const board = (await home.loadHomeOverview()).boards[0];
	const next = moveKanbanCard(
		board.doc,
		board.doc.columns[0].cards[0].id,
		board.doc.columns[1].id,
	);
	clean.mockRejectedValueOnce(new Error("localConflict"));
	await expect(home.saveHomeBoard(board, next)).rejects.toThrow(
		"localConflict",
	);
	await home.saveHomeBoard(board, next);
	expect(
		JSON.parse(await (await f.readLocalFile(path)).text()).columns[1].cards[0]
			.title,
	).toBe("Write experiment");
	await expect(home.saveHomeBoard(board, board.doc)).rejects.toThrow(
		"localConflict",
	);
	expect(
		(await f.listLocalFiles()).find((file) => file.path === path)?.dirty,
	).toBe(true);
});
