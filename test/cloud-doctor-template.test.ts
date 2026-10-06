import { IDBFactory } from "fake-indexeddb";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { PaperRecord_Serialize } from "@/lib/core/bindings";

const state = vi.hoisted(() => ({
	tabs: [] as Array<{ path: string; markdownDirty: boolean }>,
}));
vi.mock("@/lib/workspace/store", () => ({
	workspaceStore: { getState: () => state },
}));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
beforeAll(() => {
	vi.stubGlobal("indexedDB", new IDBFactory());
	const pending = new Map<string, Promise<unknown>>();
	vi.stubGlobal("navigator", {
		onLine: false,
		locks: {
			request: (name: string, fn: () => unknown) => {
				const p = (pending.get(name) ?? Promise.resolve())
					.catch(() => {})
					.then(fn);
				pending.set(name, p);
				return p;
			},
		},
	});
});
afterAll(() => vi.unstubAllGlobals());

import { localTransaction } from "@/lib/cloud/db";
import {
	applyCloudAliases,
	applyCloudWikilinks,
	checkCloudDoctor,
	contentHash,
	ignoreCloudAliases,
	planCloudWikilinks,
} from "@/lib/cloud/doctor";
import { readLocalFile, writeLocalFile } from "@/lib/cloud/files";
import {
	NOTES_TEMPLATE_PATH,
	notesTemplateSeed,
	readNoteAliases,
	renderPaperNotes,
	withNoteAliases,
} from "@/lib/vault/note-template";

const paper: PaperRecord_Serialize = {
	id: "paper",
	path: "papers/test",
	title: "Attention: A Test",
	authors: ["Example Author"],
	year: 2026,
	abstract: "First line\nSecond line",
	type: "other",
	tags: [],
	status: "new",
	is_read: false,
	added_at: "2026-01-01",
	updated_at: "2026-01-01",
};
const put = (path: string, content: string) =>
	writeLocalFile(path, new Blob([content], { type: "text/markdown" }));
const read = async (path: string) => (await readLocalFile(path)).text();
it("preserves note modes, template variables and existing custom templates", async () => {
	expect(readNoteAliases(await renderPaperNotes(paper, "blank"))).toEqual([
		paper.title,
		"Attention",
	]);
	expect(await renderPaperNotes(paper, "title-only")).not.toContain(
		paper.abstract,
	);
	expect(await renderPaperNotes(paper, "standard")).toContain(
		"> First line\n> Second line",
	);
	expect(await notesTemplateSeed("/cloud")).toEqual({ created: true });
	await put(
		NOTES_TEMPLATE_PATH,
		"# {{title}}\n{{authors}} / {{year}}\n{{abstract}}\n{{unknown}}",
	);
	expect(await notesTemplateSeed("/cloud")).toEqual({ created: false });
	const custom = await renderPaperNotes(paper, "custom");
	expect(custom).toContain("Example Author / 2026");
	expect(custom).toContain("{{unknown}}");
	expect(readNoteAliases(custom)).toEqual([paper.title, "Attention"]);
	expect(
		withNoteAliases("---\ntags: [science]\naliases: [old]\n---\nBody", [
			"new",
			"old",
		]),
	).toContain("tags: [science]");
	expect(() =>
		withNoteAliases("---\nnested:\n  key: value\n---\nBody", ["x"]),
	).toThrow();
});
it("diagnoses aliases and atomically refuses stale or unsaved repairs", async () => {
	await put(`${paper.path}/.paper.json`, JSON.stringify(paper));
	await put(`${paper.path}/NOTES.md`, "# Notes\n");
	const report = await checkCloudDoctor();
	const candidate = report.aliases.candidates[0];
	expect(report.ok).toBe(false);
	expect(candidate.titleAlias).toBe(paper.title);
	const change = { ...candidate, shortAlias: candidate.shortAlias ?? "" };
	state.tabs = [{ path: `/cloud/${candidate.path}`, markdownDirty: true }];
	await expect(applyCloudAliases([change])).rejects.toThrow("dirtyDocument");
	state.tabs = [];
	await put("second.md", "Second");
	await put(candidate.path, "Edited meanwhile");
	await expect(
		applyCloudAliases([
			{
				path: "second.md",
				titleAlias: "Second",
				shortAlias: "",
				expectedHash: await contentHash("Second"),
			},
			change,
		]),
	).rejects.toThrow("staleDocument");
	expect(await read("second.md")).toBe("Second");
	change.expectedHash = await contentHash("Edited meanwhile");
	await applyCloudAliases([change]);
	expect(readNoteAliases(await read(candidate.path))).toEqual([
		paper.title,
		"Attention",
	]);
	const file = await localTransaction(
		(files) => files.get(candidate.path),
		false,
	);
	expect(file?.dirty).toBe(true);
	await Promise.all([
		ignoreCloudAliases(["a.md"], true),
		ignoreCloudAliases(["b.md"], true),
	]);
	expect(
		JSON.parse(await read(".agentero/doctor.json")).ignoredAliasPaths.sort(),
	).toEqual(["a.md", "b.md"]);
});
it("repairs UTF-8 fragment spans without changing the target, alias, or surrounding text", async () => {
	await put("target.md", "# Existing\n");
	const source = "中文 [[target#Missing|标题]] and [链接](target.md#missing)\n";
	await put("source.md", source);
	const plan = await planCloudWikilinks();
	const edits = plan.suggestions.filter((s) => s.source === "source.md");
	expect(edits).toHaveLength(2);
	expect(edits.every((s) => s.editKind === "fragment")).toBe(true);
	expect(edits.map((s) => s.expected)).toEqual(["Missing", "missing"]);
	await applyCloudWikilinks(
		edits.map((s) => ({ ...s, replacement: "Existing" })),
	);
	expect(await read("source.md")).toBe(
		"中文 [[target#Existing|标题]] and [链接](target.md#Existing)\n",
	);
	await expect(
		applyCloudWikilinks(edits.map((s) => ({ ...s, replacement: "Other" }))),
	).rejects.toThrow("staleDocument");
});

it("preserves a concurrently created document when a delayed parser expected no file", async () => {
	await put("new-parsed.md", "Notes created while parser was running");
	await writeLocalFile(
		"new-parsed.md",
		new Blob(["Provider output"], { type: "text/markdown" }),
		{ expectedLocalId: null, preserveConflict: true },
	);
	expect(await read("new-parsed.md")).toBe("Provider output");
	const conflicts = await localTransaction(
		(files) =>
			[...files.values()].filter(
				(f) =>
					f.path.startsWith("Conflicts/") && f.path.endsWith("/new-parsed.md"),
			),
		false,
	);
	expect(conflicts).toHaveLength(1);
	expect(await conflicts[0].data!.text()).toBe(
		"Notes created while parser was running",
	);
});

it("rejects unchanged and unresolved link repairs without partially writing valid changes", async () => {
	await put("repair-a.md", "[[MissingA|Label]]\n");
	await put("repair-b.mdx", "[[MissingB]]\n");
	const edits = (await planCloudWikilinks()).suggestions.filter((item) =>
		item.source.startsWith("repair-"),
	);
	expect(edits).toHaveLength(2);
	await expect(
		applyCloudWikilinks([{ ...edits[0], replacement: edits[0].expected }]),
	).rejects.toThrow("invalidLinkRepair");
	await expect(
		applyCloudWikilinks(
			edits.map((item, index) => ({
				...item,
				replacement: index === 0 ? "target" : "StillMissing",
			})),
		),
	).rejects.toThrow("invalidLinkRepair");
	expect(await read("repair-a.md")).toBe("[[MissingA|Label]]\n");
	await applyCloudWikilinks(
		edits.map((item) => ({ ...item, replacement: "target" })),
	);
	expect(await read("repair-b.mdx")).toBe("[[target]]\n");
});
