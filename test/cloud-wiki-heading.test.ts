import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubGlobal("navigator", {
		locks: { request: (_name: string, fn: () => unknown) => fn() },
	});
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
async function fixture(target: string, source: string) {
	const files = await import("../src/lib/cloud/files");
	await files.writeLocalFile(
		"notes/Target.md",
		new Blob([target], { type: "text/markdown" }),
	);
	await files.writeLocalFile(
		"notes/Source.md",
		new Blob([source], { type: "text/markdown" }),
	);
	const { renameCloudHeading } = await import("../src/lib/cloud/wiki-heading");
	return {
		files,
		rename: (extra = {}) =>
			renameCloudHeading({
				vaultPath: "/cloud",
				path: "notes/Target.md",
				headingPath: ["Parent", "Old"],
				headingLine: 2,
				expectedContent: target,
				newText: "New",
				...extra,
			}),
		read: async (path: string) =>
			(await files.readLocalFile(`notes/${path}.md`)).text(),
	};
}
it("ports original parent/child/suffix, self-reference, embed and alias-preserving rename", async () => {
	const f = await fixture(
		"# Parent\n## Old\n[[#Old|self alias]]\n### Child\nBody\n",
		"[[Target#Parent#Old|Alias]]\n![[Target#Old#Child]]\n[label](Target.md#Parent#Old)\n[[Target#Child]]\n",
	);
	expect(await f.rename()).toMatchObject({
		oldPath: ["Parent", "Old"],
		newPath: ["Parent", "New"],
		updatedSources: ["notes/Source.md"],
		rollback: "not-needed",
	});
	expect(await f.read("Target")).toBe(
		"# Parent\n## New\n[[#New|self alias]]\n### Child\nBody\n",
	);
	expect(await f.read("Source")).toBe(
		"[[Target#Parent#New|Alias]]\n![[Target#New#Child]]\n[label](Target.md#Parent#New)\n[[Target#Child]]\n",
	);
});
it("preserves Unicode, CRLF, heading markers, titles and literal code/frontmatter", async () => {
	const target = "# Parent\r\n  ## Old ###  \r\n";
	const source =
		'---\nexample: "[[Target#Old]]"\n---\n`[[Target#Old]]`\n```md\n[[Target#Old]]\n```\n![[Target#Old|alias]]\n[label](<Target.md#Old> "title")\n';
	const f = await fixture(target, source);
	await f.rename({ newText: "新标题" });
	expect(await f.read("Target")).toBe("# Parent\r\n  ## 新标题 ###  \r\n");
	expect(await f.read("Source")).toBe(
		source
			.replace("![[Target#Old|alias]]", "![[Target#新标题|alias]]")
			.replace("<Target.md#Old>", "<Target.md#新标题>"),
	);
});
it("rejects unsaved buffers, stale snapshots and ambiguous target names without any writes", async () => {
	const target = "# Parent\n## Old\n## Taken\n";
	const f = await fixture(target, "[[Target#Parent#Old|keep]]\n");
	const original = await f.files.listLocalFiles();
	for (const [extra, code] of [
		[
			{
				dirtyPaths: [
					"notes/Target.md",
					"notes/Source.md",
					"notes/Unrelated.md",
				],
			},
			"unsavedEdits",
		],
		[{ expectedContent: "# stale\n" }, "sourceChanged"],
		[{ newText: "Taken" }, "ambiguousHeading"],
		[{ newText: "New\n## injected" }, "invalidHeading"],
		[{ newText: "New#Broken" }, "invalidHeading"],
	] as const)
		await expect(f.rename(extra)).rejects.toMatchObject({
			details: { code, rollback: "not-needed" },
		});
	expect((await f.files.listLocalFiles()).map((file) => file.localId)).toEqual(
		original.map((file) => file.localId),
	);
});
it("rejects a deep suffix that becomes ambiguous and already unresolved affected links", async () => {
	const f = await fixture(
		"# Root\n## Old\n### Section\n#### Leaf\n# Other\n## New\n### Section\n#### Leaf\n",
		"[[Target#Old#Section#Leaf]]\n",
	);
	await expect(
		f.rename({ headingPath: ["Root", "Old"] }),
	).rejects.toMatchObject({ details: { code: "ambiguousHeading" } });
	await f.files.writeLocalFile(
		"notes/Source.md",
		new Blob(["[[Target#Old#Missing]]"], { type: "text/markdown" }),
	);
	await expect(
		f.rename({ headingPath: ["Root", "Old"] }),
	).rejects.toMatchObject({ details: { code: "ambiguousHeading" } });
});
it("aborts all files when IndexedDB fails partway through a multi-file commit", async () => {
	const target = "# Parent\n## Old\n";
	const source = "[[Target#Old]]\n";
	const f = await fixture(target, source);
	const originalPut = IDBObjectStore.prototype.put;
	let writes = 0;
	vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
		this: IDBObjectStore,
		...args: Parameters<typeof originalPut>
	) {
		if (this.name === "files" && ++writes === 2)
			throw new Error("quota exceeded");
		return originalPut.apply(this, args);
	});
	await expect(f.rename()).rejects.toThrow("quota exceeded");
	expect(await f.read("Target")).toBe(target);
	expect(await f.read("Source")).toBe(source);
});

it("rechecks file identities before commit and keeps an edit that arrives during planning", async () => {
	const target = "# Parent\n## Old\n";
	const f = await fixture(target, "[[Target#Old]]\n");
	const wiki = await import("../src/lib/cloud/wiki");
	const resolve = wiki.resolveCloudLink;
	vi.spyOn(wiki, "resolveCloudLink").mockImplementationOnce(async (...args) => {
		await f.files.writeLocalFile(
			"notes/Source.md",
			new Blob(["Concurrent saved edit\n"], { type: "text/markdown" }),
		);
		return resolve(...args);
	});
	await expect(f.rename()).rejects.toMatchObject({
		details: { code: "sourceChanged", rollback: "not-needed" },
	});
	expect(await f.read("Target")).toBe(target);
	expect(await f.read("Source")).toBe("Concurrent saved edit\n");
});
