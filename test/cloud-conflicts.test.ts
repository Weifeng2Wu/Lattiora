import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
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
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
async function setup() {
	const files = await import("../src/lib/cloud/files");
	const conflicts = await import("../src/lib/cloud/conflicts");
	const write = (path: string, text: string, type = "text/markdown") =>
		files.writeLocalFile(path, new Blob([text], { type }));
	await write("notes/paper.md", "Title\nCurrent\nEnd\n");
	await write(
		"Conflicts/restore-test/notes/paper.md",
		"Title\nRecovered\nEnd\n",
	);
	return { ...files, ...conflicts, write };
}
it("lists existing restore/editor/sync/deletion conflicts and hides them from workspace search", async () => {
	const f = await setup();
	await f.write("Conflicts/editor-test/notes/other.md", "Old draft");
	await f.write(
		"Conflicts/sync-test/conflict.json",
		JSON.stringify({
			originalPath: "notes/deleted.md",
			localDeleted: true,
			recoveryPath: null,
		}),
		"application/json",
	);
	const items = await f.listFileConflicts();
	expect(items.map((item) => item.path).sort()).toEqual([
		"notes/deleted.md",
		"notes/other.md",
		"notes/paper.md",
	]);
	const { workspaceDocuments } = await import("../src/lib/cloud/wiki");
	expect((await workspaceDocuments()).map((d) => d.path)).toEqual([
		"notes/paper.md",
	]);
});
it("resolves a selected version atomically, archives both versions and preserves sibling restore conflicts", async () => {
	const f = await setup();
	await f.write("Conflicts/restore-test/notes/other.md", "Other recovery");
	const conflict = (await f.listFileConflicts()).find(
		(c) => c.path === "notes/paper.md",
	)!;
	await f.resolveFileConflict(conflict, "recovered");
	expect(await (await f.readLocalFile("notes/paper.md")).text()).toBe(
		"Title\nRecovered\nEnd\n",
	);
	expect((await f.listFileConflicts()).map((c) => c.path)).toEqual([
		"notes/other.md",
	]);
	const files = await f.listLocalFiles();
	expect(files.find((v) => v.path === conflict.id)).toMatchObject({
		deleted: 1,
		dirty: true,
	});
	const archive = files.filter((v) =>
		v.path.startsWith(".agentero/conflict-history/"),
	);
	expect(archive).toHaveLength(3);
	expect(
		await Promise.all(
			archive
				.filter((v) => !v.path.endsWith(".json"))
				.map((v) => v.data!.text()),
		),
	).toEqual(
		expect.arrayContaining([
			"Title\nCurrent\nEnd\n",
			"Title\nRecovered\nEnd\n",
		]),
	);
	const { exportBackup } = await import("../src/lib/cloud/backup");
	expect((await exportBackup()).size).toBeGreaterThan(0);
});
it("rejects stale comparisons, unsaved documents and repeat resolution without losing either version", async () => {
	const f = await setup();
	const conflict = (await f.listFileConflicts())[0];
	await f.write("notes/paper.md", "Newer edit");
	await expect(f.resolveFileConflict(conflict, "recovered")).rejects.toThrow(
		"localConflict",
	);
	const latest = (await f.listFileConflicts())[0];
	clean.mockRejectedValueOnce(new Error("localConflict"));
	await expect(f.resolveFileConflict(latest, "recovered")).rejects.toThrow(
		"localConflict",
	);
	expect(await (await f.readLocalFile("notes/paper.md")).text()).toBe(
		"Newer edit",
	);
	expect(await f.listFileConflicts()).toHaveLength(1);
	await f.resolveFileConflict(latest, "current");
	await expect(f.resolveFileConflict(latest, "recovered")).rejects.toThrow(
		"localConflict",
	);
});
it("supports deletion conflicts without confusing deleted with empty files", async () => {
	const f = await setup();
	await f.write(
		"Conflicts/deletion/conflict.json",
		JSON.stringify({
			originalPath: "notes/paper.md",
			localDeleted: true,
			recoveryPath: null,
		}),
		"application/json",
	);
	const conflict = (await f.listFileConflicts()).find((c) => c.manifest)!;
	await f.resolveFileConflict(conflict, "recovered");
	expect(
		(await f.listLocalFiles()).find((v) => v.path === "notes/paper.md"),
	).toMatchObject({ deleted: 1 });
	const recovery = (await f.listFileConflicts())[0];
	await f.resolveFileConflict(recovery, "recovered");
	expect(await (await f.readLocalFile("notes/paper.md")).text()).toContain(
		"Recovered",
	);
});
it("rolls back the original, archive and conflict cleanup together on storage failure", async () => {
	const f = await setup();
	const conflict = (await f.listFileConflicts())[0];
	const put = IDBObjectStore.prototype.put;
	vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
		this: IDBObjectStore,
		value,
		key,
	) {
		if (value?.path?.includes("/resolution.json")) throw new Error("disk full");
		return put.call(this, value, key);
	});
	await expect(f.resolveFileConflict(conflict, "recovered")).rejects.toThrow(
		"disk full",
	);
	expect(await (await f.readLocalFile("notes/paper.md")).text()).toContain(
		"Current",
	);
	expect(await f.listFileConflicts()).toHaveLength(1);
	expect(
		(await f.listLocalFiles()).filter((v) =>
			v.path.startsWith(".agentero/conflict-history/"),
		),
	).toHaveLength(0);
});
it("compares insertions and separated changes without dropping CRLF, empty lines or Unicode", async () => {
	const f = await setup();
	const left = "标题\r\nA\r\ncommon\r\nB\r\n";
	const right = "标题\r\nAA\r\ncommon\r\n\r\nBB";
	const chunks = f.compareConflictText(left, right);
	expect(chunks.filter((c) => c.changed)).toHaveLength(2);
	expect(chunks.map((c) => c.current).join("")).toBe(left);
	expect(chunks.map((c) => c.recovered).join("")).toBe(right);
	const conflict = (await f.listFileConflicts())[0];
	await f.resolveFileConflict(
		conflict,
		"merged",
		chunks.map((c, i) => (i === 1 ? c.recovered : c.current)).join(""),
	);
	expect(await (await f.readLocalFile(conflict.path)).text()).toBe(
		"标题\r\nAA\r\ncommon\r\nB\r\n",
	);
	expect(
		f.compareConflictText("x\n".repeat(2000), "y\n".repeat(2000)),
	).toHaveLength(1);
});
it("preserves binary copies and rejects merging or replacement below a file parent", async () => {
	const f = await setup();
	await f.write("notes/image.png", "current image", "image/png");
	await f.write(
		"Conflicts/editor-image/notes/image.png",
		"other image",
		"image/png",
	);
	const image = (await f.listFileConflicts()).find((c) =>
		c.path.endsWith(".png"),
	)!;
	expect(f.conflictTextSupported(image)).toBe(false);
	await expect(f.resolveFileConflict(image, "merged", "text")).rejects.toThrow(
		"invalidFile",
	);
	await f.resolveFileConflict(image, "recovered");
	expect(await (await f.readLocalFile(image.path)).text()).toBe("other image");
	await f.write("blocked", "file");
	await f.write("Conflicts/editor-blocked/blocked/child.md", "recovery");
	const blocked = (await f.listFileConflicts()).find(
		(c) => c.path === "blocked/child.md",
	)!;
	await expect(f.resolveFileConflict(blocked, "recovered")).rejects.toThrow(
		"pathExists",
	);
	expect(await (await f.readLocalFile(blocked.id)).text()).toBe("recovery");
});

it("hides the root conflict store from initial and refreshed trees, preserving ordinary nested folders", async () => {
	const f = await setup();
	await f.write("notes/Conflicts/user-note.md", "Ordinary user content");
	const { loadVaultTree, listVaultDirChildren } = await import(
		"../src/lib/vault/tree"
	);
	const tree = await loadVaultTree("/cloud");
	expect(tree.some((node) => node.name === "Conflicts")).toBe(false);
	expect(
		tree
			.find((node) => node.name === "notes")
			?.children?.some((node) => node.name === "Conflicts"),
	).toBe(true);
	expect(
		(await listVaultDirChildren("/cloud", "/cloud")).some(
			(node) => node.name === "Conflicts",
		),
	).toBe(false);
	expect(await f.listFileConflicts()).toHaveLength(1);
});

it("does not interpret malformed deletion flags as a request to delete the original", async () => {
	const f = await setup();
	await f.write(
		"Conflicts/malformed/conflict.json",
		JSON.stringify({
			originalPath: "notes/paper.md",
			localDeleted: "false",
			recoveryPath: "Conflicts/malformed/notes/paper.md",
		}),
		"application/json",
	);
	await f.write("Conflicts/malformed/notes/paper.md", "Recovered content");
	const item = (await f.listFileConflicts()).find(
		(item) => item.id === "Conflicts/malformed/notes/paper.md",
	);
	expect(item?.recovered?.deleted).toBe(0);
	expect(item?.manifest).toBeUndefined();
});

it("automatically archives only byte-identical copies and preserves originals and differing versions", async () => {
	const f = await setup();
	const pair = async (path: string, data: Blob, other = data) => {
		await f.writeLocalFile(path, data);
		await f.writeLocalFile(`Conflicts/identical/${path}`, other);
	};
	await pair("notes/same.md", new Blob(["标题\r\n\n"]));
	await f.write("Conflicts/another/notes/same.md", "标题\r\n\n");
	const binary = new Uint8Array(1024 * 1024 + 3).fill(255);
	await pair("notes/same.bin", new Blob([binary]));
	const other = binary.slice();
	other[other.length - 1] = 254;
	await pair("notes/different.bin", new Blob([binary]), new Blob([other]));
	// Both decode to the same replacement character; text comparison would lose data.
	await pair(
		"notes/invalid.txt",
		new Blob([new Uint8Array([255])]),
		new Blob([new Uint8Array([254])]),
	);
	await pair("notes/endings.md", new Blob(["A\r\n"]), new Blob(["A\n"]));
	await pair(
		"notes/types.custom",
		new Blob(["same"], { type: "text/plain" }),
		new Blob(["same"], { type: "application/json" }),
	);
	await f.write("Conflicts/identical/notes/missing.md", "Only recovered");
	const before = await f.listLocalFiles();
	const result = await f.resolveIdenticalFileConflicts(
		await f.listFileConflicts(),
	);
	expect(result).toEqual({ resolved: 3, skipped: 6, failed: [] });
	const after = await f.listLocalFiles();
	for (const path of ["notes/same.md", "notes/same.bin"])
		expect(after.find((file) => file.path === path)?.localId).toBe(
			before.find((file) => file.path === path)?.localId,
		);
	expect(
		after.filter((file) => file.path.startsWith(".agentero/conflict-history/")),
	).toHaveLength(9);
	expect(await f.listFileConflicts()).toHaveLength(6);
	expect(
		await f.resolveIdenticalFileConflicts(await f.listFileConflicts()),
	).toEqual({ resolved: 0, skipped: 6, failed: [] });
});

it("distinguishes equal deletions from missing data and empty surviving files", async () => {
	const f = await setup();
	const { localTransaction } = await import("../src/lib/cloud/db");
	for (const name of ["deleted", "empty", "missing"]) {
		await f.write(
			`Conflicts/${name}/conflict.json`,
			JSON.stringify({
				originalPath: `notes/${name}.md`,
				localDeleted: true,
				recoveryPath: null,
			}),
			"application/json",
		);
	}
	await f.write("notes/deleted.md", "old");
	await f.removeLocal("notes/deleted.md");
	await f.write("notes/empty.md", "");
	await f.write("notes/uncached.md", "same");
	await f.write("Conflicts/uncached/notes/uncached.md", "same");
	await localTransaction((files) => {
		const current = files.get("notes/uncached.md")!;
		files.set(current.path, { ...current, data: null });
	});
	expect(
		await f.resolveIdenticalFileConflicts(await f.listFileConflicts()),
	).toEqual({ resolved: 1, skipped: 4, failed: [] });
	expect(await (await f.readLocalFile("notes/empty.md")).text()).toBe("");
	expect(
		(await f.listLocalFiles()).find((file) => file.path === "notes/deleted.md")
			?.deleted,
	).toBe(1);
});

it("keeps stale, unsaved and failed copies while allowing other identical conflicts to finish", async () => {
	const f = await setup();
	for (const name of ["stale", "dirty", "failed", "success"]) {
		await f.write(`notes/${name}.md`, "same");
		await f.write(`Conflicts/batch/notes/${name}.md`, "same");
	}
	const snapshots = await f.listFileConflicts();
	await f.write("notes/stale.md", "New edit");
	clean.mockImplementation(async (path?: string) => {
		if (path === "notes/dirty.md") throw new Error("localConflict");
	});
	const put = IDBObjectStore.prototype.put;
	vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
		this: IDBObjectStore,
		value,
		key,
	) {
		if (value?.path === "Conflicts/batch/notes/failed.md" && value.deleted)
			throw new Error("disk full");
		return put.call(this, value, key);
	});
	const result = await f.resolveIdenticalFileConflicts(snapshots);
	expect(result.resolved).toBe(1);
	expect(result.skipped).toBe(1);
	expect(result.failed.map((entry) => entry.path).sort()).toEqual([
		"notes/dirty.md",
		"notes/failed.md",
		"notes/stale.md",
	]);
	expect(await f.listFileConflicts()).toHaveLength(4);
	expect(await (await f.readLocalFile("notes/stale.md")).text()).toBe(
		"New edit",
	);
	expect(
		(await f.listLocalFiles()).filter((file) =>
			file.path.startsWith(".agentero/conflict-history/"),
		),
	).toHaveLength(3);
});
