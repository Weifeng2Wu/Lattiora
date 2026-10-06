import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubGlobal("navigator", {
		locks: { request: (_name: string, fn: () => unknown) => fn() },
	});
});
afterEach(() => vi.unstubAllGlobals());
const base = {
	version: 1,
	id: "mark",
	paperPath: "/cloud/papers/test",
	createdAt: "2026-09-30",
	updatedAt: "2026-09-30",
};
const rects = [
	{ x: 0.1, y: 0.2, w: 0.4, h: 0.1 },
	{ x: 0.1, y: 0.6, w: 0.4, h: 0.1 },
];
it("matches original highlight, dialogue intensity and translation heatmap semantics", async () => {
	const { markReadingActivity } = await import(
		"../src/lib/cloud/reading-activity"
	);
	expect(
		markReadingActivity({
			...base,
			kind: "highlight",
			page: 2,
			rects,
			quote: "text",
		}),
	).toEqual({ kind: "highlight", page: 2, y: 0.45, weight: 1 });
	const messages = ["system", "user", "assistant", "user"].map(
		(role, index) => ({
			role,
			id: String(index),
			content: "text",
			createdAt: base.createdAt,
		}),
	);
	expect(
		markReadingActivity({
			...base,
			kind: "ask",
			status: "open",
			anchor: { page: 3, rects, trigger: "selection" },
			messages,
		}),
	).toEqual({ kind: "ask", page: 3, y: 0.45, weight: 3 });
	expect(
		markReadingActivity({ ...base, kind: "translate", page: 4, rects: [] }),
	).toEqual({ kind: "translate", page: 4, y: 0.5, weight: 1 });
	expect(markReadingActivity({ ...base, kind: "unknown", page: 3 })).toBeNull();
});
it("reads offline synced marks in one batch, skips aggregate/corrupt files and respects deletion", async () => {
	const { writeLocalFile, removeLocal } = await import(
		"../src/lib/cloud/files"
	);
	const { readCloudReadingActivity } = await import(
		"../src/lib/cloud/reading-activity"
	);
	const mark = { ...base, kind: "highlight", page: 1, rects, quote: "text" };
	await writeLocalFile(
		"papers/test/marks/one.json",
		new Blob([JSON.stringify(mark)]),
	);
	await writeLocalFile(
		"papers/test/marks/annotations.json",
		new Blob([JSON.stringify(mark)]),
	);
	await writeLocalFile("papers/test/marks/bad.json", new Blob(["{"]));
	const result = await readCloudReadingActivity([
		"papers/test",
		"papers/other",
	]);
	expect(result["papers/test"]).toHaveLength(1);
	expect(result["papers/other"]).toEqual([]);
	await removeLocal("papers/test/marks/one.json");
	expect(
		(await readCloudReadingActivity(["papers/test"]))["papers/test"],
	).toEqual([]);
});
