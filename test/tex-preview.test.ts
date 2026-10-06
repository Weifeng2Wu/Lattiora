import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	renderTexPreview,
	TEX_PREVIEW_MAX_LENGTH,
} from "../src/lib/tex/preview";

describe("lightweight TeX preview", () => {
	it("renders document metadata, nested formatting and body without the preamble", () => {
		const html = renderTexPreview(String.raw`\documentclass{article}
\usepackage{amsmath}
\title{A \emph{research} paper}
\author{Author}
\begin{document}
\maketitle
\section{First \textbf{result}}
Hello 世界. % invisible comment

Next paragraph with \textit{nested \textbf{formatting}} and 10\%.
\end{document}
Ignored trailing text`);
		expect(html).toContain("<h1>A <em>research</em> paper</h1>Author");
		expect(html).toContain("<h2>1 First <strong>result</strong></h2>");
		expect(html).toContain("Hello 世界.");
		expect(html).toContain("<em>nested <strong>formatting</strong></em>");
		expect(html).toContain("10%");
		expect(html).not.toMatch(
			/documentclass|usepackage|invisible comment|Ignored trailing/,
		);
	});

	it.each([
		"$x^2$",
		"$$x^2$$",
		String.raw`\(x^2\)`,
		String.raw`\[x^2\]`,
		String.raw`\begin{equation}x^2\label{eq:x}\end{equation}`,
		String.raw`\begin{align}x&=1\\ y&=2\end{align}`,
	])("renders math delimiters and environments: %s", (source) => {
		expect(renderTexPreview(source)).toContain('class="katex"');
	});

	it("keeps incomplete input, unsupported commands and environments visible", () => {
		for (const source of [
			String.raw`\input{part}`,
			String.raw`\unknown{a}{b}`,
			String.raw`\begin{figure}image\end{figure}`,
			String.raw`\begin{equation}x`,
			"$unclosed",
		]) {
			expect(renderTexPreview(source)).toContain(source);
		}
		expect(renderTexPreview(String.raw`\[\frac{1}{\]`)).toContain(
			String.raw`\frac{1}{`,
		);
		expect(renderTexPreview("$x^2$")).toContain('class="katex"');
	});

	it("renders nested lists without swallowing following text", () => {
		const html = renderTexPreview(
			String.raw`\begin{itemize}\item Outer\begin{itemize}\item Inner\end{itemize}\item Second\end{itemize}After`,
		);
		expect(html).toBe(
			"<ul><li> Outer<ul><li> Inner</li></ul></li><li> Second</li></ul>After",
		);
	});

	it("preserves verbatim text and escaped delimiters", () => {
		expect(renderTexPreview(String.raw`\verb|$x$ % \section{raw}|`)).toBe(
			"<code>$x$ % \\section{raw}</code>",
		);
		expect(
			renderTexPreview(String.raw`\begin{verbatim}% raw $x$\end{verbatim}`),
		).toBe("<pre>% raw $x$</pre>");
		expect(renderTexPreview(String.raw`Price: \$5 and \{braces\}`)).toBe(
			"Price: $5 and {braces}",
		);
	});

	it("does not inject author HTML or enable trusted KaTeX commands", () => {
		const html = renderTexPreview(
			String.raw`<img src=x onerror=alert(1)>\textbf{<script>alert(1)</script>} $\href{javascript:alert(1)}{click}$`,
		);
		expect(html).not.toMatch(/<img|<script|href="javascript:/);
		expect(html).toContain("&#60;img");
	});

	it("bounds deeply nested and oversized input", () => {
		expect(() =>
			renderTexPreview(`${"{".repeat(100)}text${"}".repeat(100)}`),
		).not.toThrow();
		expect(renderTexPreview("a".repeat(TEX_PREVIEW_MAX_LENGTH + 1))).toBe("");
		const unfinished = String.raw`\command[`.repeat(10_000);
		expect(renderTexPreview(unfinished)).toBe(`<code>${unfinished}</code>`);
	});
});

describe("paper preview references", () => {
	it("renders the shipped thesis including author notes, numbered math and bibliography", () => {
		const source = readFileSync("templates/vault/thesis/main.tex", "utf8");
		const html = renderTexPreview(source, {
			bibliographyTitle: "References",
			today: "6 October 2026",
		});
		expect(html).toContain('class="tex-note-marker">*</sup>');
		expect(html).toContain("Affiliation. <code>you@example.com</code>");
		expect(html).toContain("<h2>References</h2>");
		expect(html).toContain('class="tex-bib-label">[1]</span>');
		expect(html).toContain('class="tex-reference">[1]</span>');
		expect(html).toContain('class="tex-reference">(1)</span>');
		expect(html).toContain(
			"<em>Advances in Neural Information Processing Systems</em>",
		);
		expect(html).toContain("6 October 2026");
		expect(html).not.toMatch(
			/\\thanks|\\bibitem|\\newblock|\\begin\{thebibliography\}/,
		);
	});
	it("resolves forward citations and section/equation labels, recalculating after edits", () => {
		const source = String.raw`See \eqref{eq:b}, \ref{sec:s}, \cite{b,a}.
\section{Start}\label{sec:s}
\begin{equation}a=1\label{eq:a}\end{equation}
\begin{equation}b=2\label{eq:b}\end{equation}
\begin{thebibliography}{99}\bibitem{a}First.\bibitem[Author20]{b}Second.\end{thebibliography}`;
		const html = renderTexPreview(source);
		expect(html).toContain('class="tex-reference">(2)</span>');
		expect(html).toContain('class="tex-reference">1</span>');
		expect(html).toContain('class="tex-reference">[Author20, 1]</span>');
		expect(
			renderTexPreview(
				source.replace(
					String.raw`\begin{equation}a=1\label{eq:a}\end{equation}`,
					"",
				),
			),
		).toContain('class="tex-reference">(1)</span>');
		expect(renderTexPreview(String.raw`\eqref{eq:b}`)).toContain(
			'class="tex-reference">(eq:b)</span>',
		);
	});
	it("numbers top-level align rows while respecting stars, tags, suppression and nested matrices", () => {
		const html =
			renderTexPreview(String.raw`\eqref{a},\eqref{b},\eqref{c},\eqref{d},\eqref{e}
\begin{align}a&=\begin{matrix}1\\2\end{matrix}\label{a}\\
b&=2\notag\\ c&=3\label{b}\end{align}
\begin{equation*}d=4\end{equation*}
\begin{equation}e=5\tag{X}\label{c}\end{equation}
\begin{equation}f=6\label{d}\end{equation}
\begin{gather}g=7\nonumber\\ h=8\label{e}\end{gather}`);
		for (const value of ["1", "2", "X", "3", "4"])
			expect(html).toContain(`class="tex-reference">(${value})</span>`);
		expect(html).not.toContain("<code>");
		expect(html).not.toContain('class="eqn-num"');
	});
	it("keeps comments and verbatim out of numbering, and escapes note/reference content", () => {
		const html =
			renderTexPreview(String.raw`% \begin{equation}bad\label{fake}\end{equation}
\verb|\label{fake}|\begin{verbatim}\bibitem{fake}\end{verbatim}
Text\footnote{Nested \emph{note} $x$ <img src=x>}.\ref{fake}\cite{fake}
\begin{equation}x=1\label{real}\end{equation}\eqref{real}
\begin{thebibliography}{9}\bibitem[<img>]{safe}Safe.\end{thebibliography}\cite{safe}`);
		expect(html).toContain('class="tex-reference">(1)</span>');
		expect(html).toContain('class="tex-reference">[fake]</span>');
		expect(html).toContain("Nested <em>note</em>");
		expect(html).toContain('class="tex-reference">[&#60;img&#62;]</span>');
		expect(html).not.toContain("<img");
	});
});
