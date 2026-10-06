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
it("upgrades untouched files, preserves edits and deletions, and adopts identical legacy files", async () => {
	const { installTemplateFiles } = await import(
		"../src/lib/cloud/template-install"
	);
	const { readLocalFile, writeLocalFile, removeLocal } = await import(
		"../src/lib/cloud/files"
	);
	const first = new Map([
		["notes/a.md", "original"],
		["notes/b.md", "original"],
		["notes/c.md", "original"],
	]);
	await writeLocalFile("notes/a.md", new Blob(["original"]));
	await installTemplateFiles(first);
	await writeLocalFile("notes/b.md", new Blob(["user notes"]));
	await removeLocal("notes/c.md");
	await installTemplateFiles(
		new Map([...first].map(([path]) => [path, "updated"])),
	);
	expect(await (await readLocalFile("notes/a.md")).text()).toBe("updated");
	expect(await (await readLocalFile("notes/b.md")).text()).toBe("user notes");
	await expect(readLocalFile("notes/c.md")).rejects.toThrow();
	expect(
		await installTemplateFiles(
			new Map([
				["notes/a.md", "updated"],
				["notes/b.md", "updated"],
				["notes/c.md", "updated"],
			]),
		),
	).toEqual([]);
});
it("does not overwrite unknown legacy user files without a manifest", async () => {
	const { installTemplateFiles } = await import(
		"../src/lib/cloud/template-install"
	);
	const { writeLocalFile, readLocalFile } = await import(
		"../src/lib/cloud/files"
	);
	await writeLocalFile("AGENTS.md", new Blob(["My instructions"]));
	await installTemplateFiles(new Map([["AGENTS.md", "Bundled instructions"]]));
	expect(await (await readLocalFile("AGENTS.md")).text()).toBe(
		"My instructions",
	);
});
it("refuses a damaged manifest before touching any template", async () => {
	const { installTemplateFiles } = await import(
		"../src/lib/cloud/template-install"
	);
	const { writeLocalFile, readLocalFile } = await import(
		"../src/lib/cloud/files"
	);
	await writeLocalFile(
		".agentero/template-manifest.json",
		new Blob(['{"format":1,"files":{"notes/a.md":123}}']),
	);
	await expect(
		installTemplateFiles(new Map([["notes/a.md", "new"]])),
	).rejects.toThrow("invalidBackup");
	await expect(readLocalFile("notes/a.md")).rejects.toThrow();
});
it("does not seed below a user file that occupies a template directory", async () => {
	const { installTemplateFiles } = await import(
		"../src/lib/cloud/template-install"
	);
	const { writeLocalFile, readLocalFile } = await import(
		"../src/lib/cloud/files"
	);
	await writeLocalFile("notes", new Blob(["User file"]));
	await installTemplateFiles(new Map([["notes/example.md", "Example"]]));
	expect(await (await readLocalFile("notes")).text()).toBe("User file");
	await expect(readLocalFile("notes/example.md")).rejects.toThrow();
});
