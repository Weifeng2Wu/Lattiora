import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubGlobal("navigator", {
		locks: { request: (_name: string, run: () => unknown) => run() },
	});
});
afterEach(() => vi.unstubAllGlobals());

it("persists the shared library and preserves an intervening version as a conflict copy", async () => {
	const {
		readExcalidrawLibrary,
		writeExcalidrawLibrary,
		EXCALIDRAW_LIBRARY_PATH,
	} = await import("../src/lib/cloud/excalidraw-library");
	const { listLocalFiles } = await import("../src/lib/cloud/files");
	expect(await readExcalidrawLibrary()).toEqual({ seed: "", items: [] });
	const first = JSON.stringify({
		type: "excalidrawlib",
		version: 2,
		libraryItems: [{ id: "first", elements: [] }],
	});
	const second = first.replace("first", "second");
	await writeExcalidrawLibrary(first, "");
	await writeExcalidrawLibrary(second, "");
	expect((await readExcalidrawLibrary()).seed).toBe(second);
	const files = await listLocalFiles();
	expect(
		files.find((file) => file.path === EXCALIDRAW_LIBRARY_PATH)?.dirty,
	).toBe(true);
	const conflict = files.find((file) => file.path.startsWith("Conflicts/"));
	expect(await conflict?.data?.text()).toBe(first);
});
