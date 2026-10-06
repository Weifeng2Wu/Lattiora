import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubGlobal("navigator", {
		locks: { request: (_key: string, fn: () => unknown) => fn() },
	});
});
afterEach(() => vi.unstubAllGlobals());
it("finds source file paths without reading binary data and keeps note matches on their paper", async () => {
	const { writeLocalFile } = await import("../src/lib/cloud/files");
	const { cloudSearch } = await import("../src/lib/cloud/wiki");
	await writeLocalFile(
		"papers/sample/source/main.tex",
		new Blob(["\\documentclass{article}"]),
	);
	await writeLocalFile(
		"papers/sample/NOTES.md",
		new Blob(["# Notes\nunique research passage"]),
	);
	await writeLocalFile(
		"papers/sample/source/comment.md",
		new Blob(["# Source comment\nunique research passage"]),
	);
	await writeLocalFile(
		".agentero/private.md",
		new Blob(["unique research passage"]),
	);
	const files = await cloudSearch("sample/source/main.tex");
	expect(files.hits).toHaveLength(1);
	expect(files.hits[0]).toMatchObject({
		path: "papers/sample/source/main.tex",
		paperPath: null,
		line: 1,
	});
	const notes = await cloudSearch("unique research passage");
	expect(notes.hits).toHaveLength(2);
	expect(notes.hits.find((h) => h.path.endsWith("NOTES.md"))?.paperPath).toBe(
		"papers/sample",
	);
	expect(
		notes.hits.find((h) => h.path.endsWith("comment.md"))?.paperPath,
	).toBeNull();
});
