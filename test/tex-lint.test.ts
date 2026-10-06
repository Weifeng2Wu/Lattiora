import type { Diagnostic } from "@codemirror/lint";
import { EditorState, type Extension } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { latexLinter } from "codemirror-lang-latex";
import { describe, expect, it } from "vitest";
import { textLanguageExtensions } from "@/components/viewer/text-editor-language";

/**
 * Runs the pack's linter (the same function `latex()` wires in when
 * enableLinting is on) over a document assembled exactly like the editor
 * does — basicSetup plus our TeX extensions, fileName from the path's
 * basename. Asserts which documents produce diagnostics so "no squiggle"
 * always has a written-down reason.
 */
function lint(doc: string, fileName = "main.tex"): Diagnostic[] {
	const extensions: Extension[] = [
		basicSetup,
		...textLanguageExtensions(`/vault/thesis/${fileName}`),
	];
	const state = EditorState.create({ doc, extensions });
	return latexLinter({ fileName })({ state } as never);
}

const PREAMBLE = "\\documentclass{article}\n\\title{Demo}\n\\author{Phil}\n";

describe("latexLinter behavior", () => {
	it("stays quiet on a healthy document", () => {
		const doc = `${PREAMBLE}\\begin{document}\n\\maketitle\n\\section{One}\nHello.\n\\end{document}\n`;
		expect(lint(doc)).toEqual([]);
	});

	it("flags an unclosed environment", () => {
		const doc = `${PREAMBLE}\\begin{document}\n\\begin{itemize}\n\\item x\n\\end{document}\n`;
		const diagnostics = lint(doc);
		expect(diagnostics.length).toBeGreaterThan(0);
		expect(diagnostics.some((d) => /\\end\{itemize\}/.test(d.message))).toBe(
			true,
		);
		expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
	});

	it("flags a reference to a label that is never defined", () => {
		const doc = `${PREAMBLE}\\begin{document}\nSee \\ref{nope} and \\ref{also-nope}.\n\\end{document}\n`;
		const diagnostics = lint(doc);
		expect(diagnostics.some((d) => /nope/i.test(d.message))).toBe(true);
	});

	it("does not require \\begin{document} in a .cls file", () => {
		// Same long-enough, document-env-less source — only the extension
		// changes (the linter relaxes document rules for packages/classes).
		const doc = `${"%.".repeat(60)}\n\\NeedsTeXFormat{LaTeX2e}\n\\ProvidesClass{demo}\n\\RequirePackage{amsmath}\n`;
		expect(
			lint(doc, "main.tex").some((d) =>
				/document environment/i.test(d.message),
			),
		).toBe(true);
		expect(lint(doc, "main.cls")).toEqual([]);
	});
});
