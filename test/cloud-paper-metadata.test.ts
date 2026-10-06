import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { patchNoteTitle } from "../src/lib/paper/note-title";

vi.mock("../src/lib/settings", () => ({
	loadSettings: () => ({ paperNoteMode: "blank" }),
}));
beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("indexedDB", new IDBFactory());
	const queues = new Map<string, Promise<unknown>>();
	vi.stubGlobal("navigator", {
		locks: {
			request: (key: string, fn: () => unknown) => {
				const next = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
				queues.set(
					key,
					next.catch(() => undefined),
				);
				return next;
			},
		},
	});
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
it("preserves original aliases and custom YAML while replacing only placeholder headings", () => {
	const note =
		'---\naliases:\n  - "Short"\ncustom:\n  nested: keep\n---\n# old-paper.pdf\n\nMy notes stay.\n';
	const next = patchNoteTitle(
		note,
		"https://example.org/old-paper.pdf",
		"New research title",
	);
	expect(next).toContain('  - "Short"');
	expect(next).toContain('  - "https://example.org/old-paper.pdf"');
	expect(next).toContain('  - "New research title"');
	expect(next).toContain("custom:\n  nested: keep\n");
	expect(next).toContain("# New research title\n\nMy notes stay.");
	expect(
		patchNoteTitle("# My own heading\nA conclusion.\n", "Old", "New"),
	).toContain("# My own heading\nA conclusion.");
	expect(
		patchNoteTitle("A headingless conclusion.\n", "Old", "New"),
	).not.toContain("# New");
	expect(patchNoteTitle("old-paper.pdf\n", "old-paper.pdf", "New")).toContain(
		"# New\n",
	);
});
it("commits title metadata and note aliases together and rejects stale metadata versions", async () => {
	const files = await import("../src/lib/cloud/files");
	const { updateCloudPaper, makePaper } = await import(
		"../src/lib/cloud/catalog"
	);
	const path = "papers/example",
		meta = `${path}/.paper.json`,
		notes = `${path}/NOTES.md`;
	await files.writeLocalFile(
		meta,
		new Blob([JSON.stringify(makePaper(path, "Old"))]),
	);
	await files.writeLocalFile(notes, new Blob(["# Old\nUser notes\n"]));
	const initial = (await files.listLocalFiles()).find((f) => f.path === meta);
	const updated = await updateCloudPaper(
		path,
		{ title: "New" },
		{ expectedLocalId: initial?.localId },
	);
	expect(updated.title).toBe("New");
	expect(updated.meta_source).toBe("manual");
	expect(await (await files.readLocalFile(notes)).text()).toContain(
		"# New\nUser notes",
	);
	await expect(
		updateCloudPaper(
			path,
			{ title: "Stale" },
			{ expectedLocalId: initial?.localId },
		),
	).rejects.toThrow("metadataChanged");
	expect(JSON.parse(await (await files.readLocalFile(meta)).text()).title).toBe(
		"New",
	);
});
it("preserves concurrent note edits and malformed alias frontmatter without partial metadata changes", async () => {
	const files = await import("../src/lib/cloud/files");
	const { updateCloudPaper, makePaper } = await import(
		"../src/lib/cloud/catalog"
	);
	const path = "papers/example",
		meta = `${path}/.paper.json`,
		notes = `${path}/NOTES.md`;
	await files.writeLocalFile(
		meta,
		new Blob([JSON.stringify(makePaper(path, "Old"))]),
	);
	await files.writeLocalFile(notes, new Blob(["# Old\n"]));
	const text = Blob.prototype.text;
	let changed = false;
	vi.spyOn(Blob.prototype, "text").mockImplementation(async function (
		this: Blob,
	) {
		const content = await text.call(this);
		if (content === "# Old\n" && !changed) {
			changed = true;
			await files.writeLocalFile(notes, new Blob(["# My edit\n"]));
		}
		return content;
	});
	await expect(updateCloudPaper(path, { title: "New" })).rejects.toThrow(
		"metadataChanged",
	);
	expect(JSON.parse(await (await files.readLocalFile(meta)).text()).title).toBe(
		"Old",
	);
	expect(await (await files.readLocalFile(notes)).text()).toBe("# My edit\n");
	await files.writeLocalFile(
		notes,
		new Blob(["---\naliases: [broken\n---\n# Old\n"]),
	);
	await expect(updateCloudPaper(path, { title: "New" })).rejects.toThrow(
		"invalidFrontmatter",
	);
	expect(JSON.parse(await (await files.readLocalFile(meta)).text()).title).toBe(
		"Old",
	);
});

it("serializes tag and title patches without restoring stale metadata or changing recognition provenance", async () => {
	const files = await import("../src/lib/cloud/files");
	const { makePaper, updateCloudPaper, setCloudPaperTags } = await import(
		"../src/lib/cloud/catalog"
	);
	const path = "papers/tags";
	await files.writeLocalFile(
		`${path}/.paper.json`,
		new Blob([
			JSON.stringify(makePaper(path, "Old", { meta_source: "recognize" })),
		]),
	);
	await Promise.all([
		updateCloudPaper(path, { title: "New" }, { metaSource: "recognize" }),
		setCloudPaperTags(path, [{ name: "Important", color: null }]),
	]);
	const value = JSON.parse(
		await (await files.readLocalFile(`${path}/.paper.json`)).text(),
	);
	expect(value.title).toBe("New");
	expect(value.tags).toEqual([{ name: "Important", color: null }]);
	expect(value.meta_source).toBe("recognize");
});
it("rescan does not turn nested source figures or paper attachments into new papers", async () => {
	const files = await import("../src/lib/cloud/files");
	const { makePaper, rescanCloudPapers } = await import(
		"../src/lib/cloud/catalog"
	);
	await files.writeLocalFile(
		"papers/main/.paper.json",
		new Blob([JSON.stringify(makePaper("papers/main", "Main"))]),
	);
	await files.writeLocalFile(
		"papers/main/source/figures/plot.pdf",
		new Blob(["%PDF-figure"]),
	);
	await files.writeLocalFile(
		"papers/main/attachments/slides/slide.pdf",
		new Blob(["%PDF-slides"]),
	);
	expect(await rescanCloudPapers()).toEqual({ count: 0 });
	expect(
		(await files.listLocalFiles()).filter((f) =>
			f.path.endsWith("/.paper.json"),
		),
	).toHaveLength(1);
});
