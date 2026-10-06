import { IDBFactory } from "fake-indexeddb";
import { unzipSync, zipSync } from "fflate";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubGlobal("navigator", {
		locks: {
			request: async (_name: string, fn: () => Promise<unknown>) => fn(),
		},
	});
});
afterEach(() => vi.unstubAllGlobals());
it("restores binary files and preserves changed local notes without duplicating identical content", async () => {
	const files = await import("../src/lib/cloud/files");
	const { exportBackup, restoreBackup } = await import(
		"../src/lib/cloud/backup"
	);
	await files.writeLocalFile("notes/research.md", new Blob(["backed up note"]));
	await files.writeLocalFile(
		"papers/test/paper.pdf",
		new Blob([new Uint8Array([0, 1, 255, 10])], { type: "application/pdf" }),
	);
	const backup = await exportBackup();
	await files.writeLocalFile(
		"notes/research.md",
		new Blob(["newer local contribution"]),
	);
	await restoreBackup(backup);
	expect(await (await files.readLocalFile("notes/research.md")).text()).toBe(
		"backed up note",
	);
	expect([
		...new Uint8Array(
			await (await files.readLocalFile("papers/test/paper.pdf")).arrayBuffer(),
		),
	]).toEqual([0, 1, 255, 10]);
	const conflicts = (await files.listLocalFiles()).filter((file) =>
		file.path.startsWith("Conflicts/"),
	);
	expect(conflicts).toHaveLength(1);
	expect(await conflicts[0].data?.text()).toBe("newer local contribution");
	await restoreBackup(backup);
	expect(
		(await files.listLocalFiles()).filter((file) =>
			file.path.startsWith("Conflicts/"),
		),
	).toHaveLength(1);
});
it("rejects a corrupted archive before modifying any local file", async () => {
	const files = await import("../src/lib/cloud/files");
	const { exportBackup, restoreBackup } = await import(
		"../src/lib/cloud/backup"
	);
	await files.writeLocalFile("notes/first.md", new Blob(["original A"]));
	await files.writeLocalFile("notes/second.md", new Blob(["original B"]));
	const entries = unzipSync(
		new Uint8Array(await (await exportBackup()).arrayBuffer()),
	);
	entries["files/notes/second.md"] = new TextEncoder().encode(
		"corrupted bytes",
	);
	await files.writeLocalFile("notes/first.md", new Blob(["keep my changes"]));
	const before = await files.listLocalFiles();
	await expect(
		restoreBackup(new Blob([zipSync(entries).buffer as ArrayBuffer])),
	).rejects.toThrow("invalidBackup");
	expect((await files.listLocalFiles()).map((f) => f.localId)).toEqual(
		before.map((f) => f.localId),
	);
	expect(await (await files.readLocalFile("notes/first.md")).text()).toBe(
		"keep my changes",
	);
});

it("moves files and rewrites links atomically, with header embeds available offline", async () => {
	const files = await import("../src/lib/cloud/files");
	const { moveCloudPath, readCloudEmbed } = await import(
		"../src/lib/cloud/wiki"
	);
	await files.writeLocalFile(
		"notes/target.md",
		new Blob([
			"# Findings\n\nEvidence.\n\n## Detail\n\nMore.\n\n# Other\n\nElsewhere.",
		]),
	);
	await files.writeLocalFile(
		"notes/reference.md",
		new Blob(["[[target#Findings]] and [target](target.md)\n\n`[[target]]`"]),
	);
	const embedded = await readCloudEmbed(
		"notes/reference.md",
		"target#Findings",
	);
	expect(embedded.content).toContain("Evidence.");
	expect(embedded.content).not.toContain("Elsewhere.");
	await moveCloudPath("notes/target.md", "notes/renamed.md");
	const text = await (await files.readLocalFile("notes/reference.md")).text();
	expect(text).toContain("[[notes/renamed#Findings]]");
	expect(text).toContain("[target](renamed.md)");
	expect(text).toContain("`[[target]]`");
	await expect(
		files.moveLocal("notes/renamed.md", "notes/failed.md", [
			{
				path: "notes/reference.md",
				before: "stale contents",
				after: "bad rewrite",
			},
		]),
	).rejects.toThrow("localConflict");
	expect(
		await (await files.readLocalFile("notes/renamed.md")).text(),
	).toContain("Evidence.");
	await expect(files.readLocalFile("notes/failed.md")).rejects.toThrow();
});
