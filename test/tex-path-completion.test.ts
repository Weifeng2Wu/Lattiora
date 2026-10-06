import {
	CompletionContext,
	type CompletionResult,
} from "@codemirror/autocomplete";
import { LanguageSupport } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { latexLanguage } from "codemirror-lang-latex";
import { describe, expect, it } from "vitest";
import {
	parseTexPathContext,
	TEX_PATH_COMMANDS,
	texEntryCompletions,
	texPathCompletionSource,
	textLanguageExtensions,
} from "@/components/viewer/text-editor-language";
import type { FileNode } from "@/lib/vault";

function file(name: string): FileNode {
	return { id: name, name, path: name, kind: "file" };
}

function dir(name: string): FileNode {
	return { id: name, name, path: name, kind: "directory" };
}

describe("textLanguageExtensions TeX routing", () => {
	it("wires the latex language pack, path completion and chktex linter for .tex", () => {
		const extensions = textLanguageExtensions("/vault/plans/a.tex");
		expect(extensions).toHaveLength(3);
		expect(extensions[0]).toBeInstanceOf(LanguageSupport);
		expect((extensions[0] as LanguageSupport).language).toBe(latexLanguage);
	});

	it("registers the pack's command completion alongside the path completion", () => {
		// Both must surface through the language data — an autocompletion
		// `override` layer (the pack's default enableAutocomplete) would
		// swallow one of them.
		const extensions = textLanguageExtensions("/vault/plans/a.tex");
		const state = EditorState.create({
			doc: "\\input{",
			extensions: [basicSetup, ...extensions],
		});
		const sources = state.languageDataAt("autocomplete", 1);
		expect(sources.length).toBeGreaterThanOrEqual(2);
	});

	it("serves the pack's command completion without enableAutocomplete", async () => {
		// The pack's latex() unconditionally hangs its command source on the
		// language data, and basicSetup's autocompletion consults it — so the
		// switch itself must stay off (its override layer would swallow the
		// path completion). Typing "\docum" must still offer \documentclass.
		const extensions = textLanguageExtensions("/vault/plans/a.tex");
		const state = EditorState.create({
			doc: "\\docum",
			extensions: [basicSetup, ...extensions],
		});
		const sources = state.languageDataAt("autocomplete", 1);
		const results = await Promise.all(
			sources.map((source) =>
				source(new CompletionContext(state, state.doc.length, false)),
			),
		);
		const labels = results
			.flatMap((r) => (r ? r.options : []))
			.map((o) => o.label);
		expect(labels).toContain("\\documentclass");
	});

	it("keeps unknown extensions bare", () => {
		expect(textLanguageExtensions("/vault/plans/a.txt")).toEqual([]);
	});
});

describe("parseTexPathContext", () => {
	it("detects path commands after the opening brace", () => {
		expect(parseTexPathContext("\\input{fig")).toEqual({
			command: "input",
			dirPrefix: "",
			segmentFrom: 7,
		});
	});

	it("accepts optional arguments before the brace", () => {
		expect(
			parseTexPathContext("\\includegraphics[width=\\textwidth]{fig"),
		).toEqual({
			command: "includegraphics",
			dirPrefix: "",
			segmentFrom: 35,
		});
	});

	it("splits the typed directory prefix at the last slash", () => {
		expect(parseTexPathContext("\\includegraphics{figures/sub/plan")).toEqual({
			command: "includegraphics",
			dirPrefix: "figures/sub/",
			segmentFrom: 29,
		});
	});

	it("strips a leading ./ from the directory prefix", () => {
		expect(parseTexPathContext("\\input{./fig")?.dirPrefix).toBe("");
		expect(parseTexPathContext("\\input{./fig")?.segmentFrom).toBe(9);
	});

	it("accepts the starred command variant", () => {
		expect(parseTexPathContext("\\includegraphics*{fig")?.command).toBe(
			"includegraphics",
		);
	});

	it("ignores non-path commands, closed groups and escapes", () => {
		expect(parseTexPathContext("\\textbf{hello")).toBeNull();
		expect(parseTexPathContext("\\emph{a} then {")).toBeNull();
		expect(parseTexPathContext("\\input{a\\b")).toBeNull();
	});
});

describe("texEntryCompletions", () => {
	const entries = [
		dir("figures"),
		file("main.tex"),
		file("intro.tex"),
		file("README"),
		file("plot.pdf"),
		file("refs.bib"),
	];

	it("offers directories with a trailing slash and boost", () => {
		const options = texEntryCompletions(
			entries,
			TEX_PATH_COMMANDS.input,
			"main.tex",
		);
		const folder = options.find((o) => o.label === "figures/");
		expect(folder?.boost).toBe(99);
	});

	it("filters by command: input keeps .tex and extension-less files", () => {
		const labels = texEntryCompletions(
			entries,
			TEX_PATH_COMMANDS.input,
			"main.tex",
		).map((o) => o.label);
		expect(labels).toContain("intro.tex");
		expect(labels).toContain("README");
		expect(labels).not.toContain("main.tex");
		expect(labels).not.toContain("plot.pdf");
		expect(labels).not.toContain("refs.bib");
	});

	it("filters by command: includegraphics keeps graphics only", () => {
		const labels = texEntryCompletions(
			entries,
			TEX_PATH_COMMANDS.includegraphics,
			"main.tex",
		).map((o) => o.label);
		expect(labels).toEqual(["figures/", "plot.pdf"]);
	});

	it("strips the .bib label for \\bibliography but keeps it for \\addbibresource", () => {
		const bibtex = texEntryCompletions(
			entries,
			TEX_PATH_COMMANDS.bibliography,
			"main.tex",
		);
		expect(bibtex).toEqual([
			{ label: "figures/", boost: 99 },
			{ label: "refs", detail: "refs.bib" },
		]);
		const biblatex = texEntryCompletions(
			entries,
			TEX_PATH_COMMANDS.addbibresource,
			"main.tex",
		);
		expect(biblatex).toEqual([
			{ label: "figures/", boost: 99 },
			{ label: "refs.bib" },
		]);
	});
});

describe("texPathCompletionSource", () => {
	const listDir = async (dirAbs: string): Promise<FileNode[]> => {
		if (dirAbs === "/vault/thesis") {
			return [dir("figures"), file("main.tex"), file("intro.tex")];
		}
		if (dirAbs === "/vault/thesis/figures") return [file("plot.pdf")];
		return [];
	};

	function resultAt(doc: string): Promise<CompletionResult | null> {
		const source = texPathCompletionSource("/vault/thesis/main.tex", listDir);
		const state = EditorState.create({ doc });
		const context = new CompletionContext(state, state.doc.length, false);
		return source(context);
	}

	it("lists the file's own directory for an empty prefix", async () => {
		const result = await resultAt("\\input{");
		expect(result?.from).toBe(7);
		expect(result?.options.map((o) => o.label)).toEqual([
			"figures/",
			"intro.tex",
		]);
	});

	it("lists the typed subdirectory and completes from after the slash", async () => {
		const result = await resultAt("\\includegraphics{figures/p");
		expect(result?.from).toBe("\\includegraphics{figures/".length);
		expect(result?.options.map((o) => o.label)).toEqual(["plot.pdf"]);
	});

	it("returns null outside path arguments or for empty listings", async () => {
		expect(await resultAt("\\textbf{bold text")).toBeNull();
		expect(await resultAt("\\input{missing/")).toBeNull();
	});

	it("keeps the listing while the directory prefix is unchanged", async () => {
		const result = await resultAt("\\input{");
		const validFor = result?.validFor;
		if (typeof validFor !== "function") throw new Error("validFor missing");
		const same = EditorState.create({ doc: "\\input{in" });
		expect(validFor("in", 7, same.doc.length, same)).toBe(true);
	});

	it("invalidates when another slash or a different directory is typed", async () => {
		const result = await resultAt("\\input{");
		const validFor = result?.validFor;
		if (typeof validFor !== "function") throw new Error("validFor missing");
		const deeper = EditorState.create({ doc: "\\input{figures/p" });
		expect(validFor("figures/p", 7, deeper.doc.length, deeper)).toBe(false);
		const outside = EditorState.create({ doc: "plain prose" });
		expect(validFor("", 7, outside.doc.length, outside)).toBe(false);
	});
});
