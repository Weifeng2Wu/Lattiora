import type {
	Completion,
	CompletionContext,
	CompletionResult,
} from "@codemirror/autocomplete";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { StreamLanguage } from "@codemirror/language";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { type Diagnostic, linter } from "@codemirror/lint";
import type { Extension, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { latex, latexLanguage } from "codemirror-lang-latex";
import { commands } from "@/lib/core/bindings";
import { basenameOf, dirnameOf, joinPath } from "@/lib/core/path";
import { type FileNode, listVaultDirChildren } from "@/lib/vault";
import { vaultStore } from "@/lib/vault/store";
import { textLanguageIdForPath } from "@/lib/workspace/viewer";

/**
 * Language support for the plain-text editor, keyed off the path extension
 * (routing lives in `textLanguageIdForPath`). Unknown extensions get no
 * highlighting — plain text is the fallback viewer, not a gate.
 */

const yamlLanguage = StreamLanguage.define(yaml);

/**
 * Minimal BibTeX tokenizer (no upstream legacy mode ships one):
 * `%{ … %}` comments, `@type` keywords, entry keys and bare words as
 * variables, `field =` names as properties, quoted/braced values as strings.
 */
const bibtexLanguage = StreamLanguage.define<{ inComment: boolean }>({
	startState: () => ({ inComment: false }),
	token(stream, state) {
		if (state.inComment) {
			if (stream.match(/^.*?%}/)) state.inComment = false;
			else stream.skipToEnd();
			return "comment";
		}
		if (stream.eatSpace()) return null;
		if (stream.match(/^%{/)) {
			state.inComment = true;
			return "comment";
		}
		if (stream.eat("@")) {
			stream.match(/^[A-Za-z]+/);
			return "keyword";
		}
		if (stream.match(/^[A-Za-z][A-Za-z0-9_-]*(?=\s*=)/)) return "property";
		if (stream.match(/^"[^"]*"?/)) return "string";
		if (stream.match(/^[{}(),=]/)) return "operator";
		if (stream.match(/^[^{}\s,"=@%]+/)) return "variable";
		stream.next();
		return null;
	},
});

const BIBTEX_ENTRY_TYPES: Completion[] = (
	[
		["article", "Journal article"],
		["inproceedings", "Conference paper"],
		["incollection", "Chapter in a book"],
		["book", "Book"],
		["inbook", "Part of a book"],
		["phdthesis", "PhD thesis"],
		["mastersthesis", "Master's thesis"],
		["techreport", "Technical report"],
		["proceedings", "Proceedings volume"],
		["unpublished", "Unpublished work"],
		["misc", "Miscellaneous"],
		["online", "Online resource"],
	] as const
).map(([type, detail]) => ({
	label: `@${type}`,
	detail,
	type: "keyword",
}));

const BIBTEX_FIELDS: Completion[] = (
	[
		"title",
		"author",
		"editor",
		"year",
		"month",
		"journal",
		"booktitle",
		"volume",
		"number",
		"pages",
		"publisher",
		"address",
		"edition",
		"series",
		"institution",
		"school",
		"organization",
		"howpublished",
		"doi",
		"url",
		"isbn",
		"issn",
		"keywords",
		"abstract",
		"note",
	] as const
).map((field) => ({ label: field, type: "property" }));

function bibtexCompletion(context: CompletionContext): CompletionResult | null {
	// Entry type right after `@` (also auto-opens the menu while typing).
	const entryType = context.matchBefore(/@[A-Za-z]*/);
	if (entryType) {
		return {
			from: entryType.from,
			options: BIBTEX_ENTRY_TYPES,
			validFor: /^@?[A-Za-z]*$/,
		};
	}
	// Field name at the start of a fresh line inside an entry.
	const line = context.state.doc.lineAt(context.pos);
	const before = line.text.slice(0, context.pos - line.from);
	const word = before.match(/^\s*([A-Za-z-]*)$/)?.[1];
	if (
		word != null &&
		/@[A-Za-z]+\s*[({]/.test(context.state.sliceDoc(0, line.from))
	) {
		return {
			from: line.from + before.length - word.length,
			options: BIBTEX_FIELDS,
			validFor: /^[A-Za-z-]*$/,
		};
	}
	return null;
}

/** What a LaTeX command's `{}` file-path argument may complete to. */
export type TexPathCommandSpec = {
	/** Lowercase extensions (with dot) offered for the command. */
	extensions: string[];
	/** Also offer extension-less files: `\input{foo}` implicitly reads `foo.tex`. */
	allowMissingExtension?: boolean;
	/** `\bibliography{refs}` wants the base name (bibtex appends `.bib`). */
	stripExtensionFromLabel?: boolean;
};

export const TEX_PATH_COMMANDS: Record<string, TexPathCommandSpec> = {
	input: { extensions: [".tex"], allowMissingExtension: true },
	include: { extensions: [".tex"], allowMissingExtension: true },
	includeonly: { extensions: [".tex"], allowMissingExtension: true },
	includegraphics: {
		extensions: [
			".pdf",
			".png",
			".jpg",
			".jpeg",
			".gif",
			".svg",
			".eps",
			".bmp",
		],
	},
	includepdf: { extensions: [".pdf"] },
	includesvg: { extensions: [".svg"] },
	bibliography: { extensions: [".bib"], stripExtensionFromLabel: true },
	addbibresource: { extensions: [".bib"] },
};

export type TexPathContext = {
	/** Command name (`input`, `includegraphics`, …). */
	command: string;
	/** Typed directory prefix (`figures/`), `./`-stripped; `""` = the file's own dir. */
	dirPrefix: string;
	/** Doc offset where the completing segment starts (right after the last `/`). */
	segmentFrom: number;
};

/** Characters that end path-completion matching inside the braces. */
const TEX_PATH_INVALID = /[{}%\\\n]/;

/**
 * Detect a file-path argument at the cursor: the nearest unclosed `{` whose
 * preceding command takes a path (`\input{`, `\includegraphics[…]{`, …).
 * Returns null outside such an argument — prose like `\textbf{…}` never
 * triggers a path menu.
 */
export function parseTexPathContext(before: string): TexPathContext | null {
	const brace = before.lastIndexOf("{");
	if (brace === -1) return null;
	// A `}` after the last `{`: the cursor sits past that group, not inside it.
	if (before.lastIndexOf("}") > brace) return null;
	const typed = before.slice(brace + 1);
	if (TEX_PATH_INVALID.test(typed)) return null;
	const command = before
		.slice(0, brace)
		.match(/\\([a-zA-Z]+)\*?\s*(?:\[[^[\]{}]*]\s*)*$/)?.[1];
	if (!command || !TEX_PATH_COMMANDS[command]) return null;
	const slash = typed.lastIndexOf("/");
	return {
		command,
		dirPrefix:
			slash === -1 ? "" : typed.slice(0, slash + 1).replace(/^\.\//, ""),
		segmentFrom: brace + slash + 2,
	};
}

/**
 * Map one directory listing to completion options: directories carry a
 * trailing `/` (selecting one continues completion inside it) and sort first,
 * then files accepted by the command's spec; the edited file itself is never
 * offered.
 */
export function texEntryCompletions(
	entries: FileNode[],
	spec: TexPathCommandSpec,
	selfBaseName: string,
): Completion[] {
	const selfKey = selfBaseName.toLowerCase();
	const options: Completion[] = [];
	for (const entry of entries) {
		if (entry.kind === "directory") {
			options.push({ label: `${entry.name}/`, boost: 99 });
			continue;
		}
		if (entry.name.toLowerCase() === selfKey) continue;
		const dot = entry.name.lastIndexOf(".");
		const ext = dot === -1 ? "" : entry.name.slice(dot).toLowerCase();
		if (
			!spec.extensions.includes(ext) &&
			!(ext === "" && spec.allowMissingExtension)
		) {
			continue;
		}
		options.push(
			spec.stripExtensionFromLabel && dot > 0
				? { label: entry.name.slice(0, dot), detail: entry.name }
				: { label: entry.name },
		);
	}
	return options;
}

/** Lists one directory level for path completion; injectable for tests. */
export type TexDirLister = (dirAbs: string) => Promise<FileNode[]>;

const TEX_DIR_CACHE_TTL_MS = 10_000;
const TEX_DIR_CACHE_MAX = 32;

/**
 * Completion source for file-path arguments of LaTeX commands. Paths resolve
 * against the edited file's directory — `run_latexmk` compiles with the .tex
 * parent as cwd, so that is what `\input{…}` sees at compile time. Listings
 * are fetched one level at a time (Host tree command locally, SFTP remotely,
 * same ignore rules as the file tree) and cached briefly per editor so
 * backspacing / reopening the menu stays snappy.
 */
export function texPathCompletionSource(
	filePath: string,
	listDir: TexDirLister,
): (context: CompletionContext) => Promise<CompletionResult | null> {
	const fileDir = dirnameOf(filePath);
	const selfBaseName = basenameOf(filePath);
	const cache = new Map<string, { at: number; entries: FileNode[] }>();
	return async (context) => {
		const parsed = parseTexPathContext(context.state.sliceDoc(0, context.pos));
		if (!parsed) return null;
		const dirAbs = joinPath(fileDir, parsed.dirPrefix.replace(/\/+$/, ""));
		let entries: FileNode[];
		const hit = cache.get(dirAbs);
		if (hit && Date.now() - hit.at < TEX_DIR_CACHE_TTL_MS) {
			entries = hit.entries;
		} else {
			entries = await listDir(dirAbs).catch(() => []);
			if (cache.size >= TEX_DIR_CACHE_MAX) cache.clear();
			cache.set(dirAbs, { at: Date.now(), entries });
		}
		const options = texEntryCompletions(
			entries,
			TEX_PATH_COMMANDS[parsed.command],
			selfBaseName,
		);
		if (options.length === 0) return null;
		const dirAtQuery = parsed.dirPrefix;
		return {
			from: parsed.segmentFrom,
			options,
			// Re-query when the typed directory prefix changes (another `/`
			// typed or backspaced) or the cursor leaves the path argument; keep
			// this listing while typing inside the same segment.
			validFor: (_text, _from, to, state) => {
				const next = parseTexPathContext(state.sliceDoc(0, to));
				return next !== null && next.dirPrefix === dirAtQuery;
			},
		};
	};
}

/**
 * Real directory lister: one level under `dirAbs` via the Host tree command
 * (local) or SFTP (remote), applying the file-tree ignore rules.
 */
async function listVaultDirForTex(dirAbs: string): Promise<FileNode[]> {
	const vaultPath = vaultStore.getState().vaultPath;
	if (!vaultPath) return [];
	return listVaultDirChildren(vaultPath, dirAbs).catch(() => []);
}

/** One chktex finding as returned by the Rust `chktex_lint` command. */
export type ChktexFinding = {
	/** 1-based line in the linted buffer. */
	line: number;
	/** 1-based character column within the line. */
	column: number;
	/** Length of the offending span in characters. */
	length: number;
	/** Mapped chktex kind: "error" | "warning" | "info". */
	severity: string;
	/** chktex warning number — suppress inline with a `%chktex <n>` comment. */
	code: number;
	message: string;
};

/**
 * Map chktex findings (1-based line/column + match length) to editor-span
 * diagnostics. The coordinates come from the exact buffer we sent, but stay
 * defensive anyway: out-of-range lines drop, spans clamp to the document.
 */
export function chktexDiagnostics(
	findings: ChktexFinding[],
	doc: Text,
): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	for (const finding of findings) {
		if (finding.line < 1 || finding.line > doc.lines) continue;
		const line = doc.line(finding.line);
		const from = Math.min(line.from + Math.max(finding.column - 1, 0), line.to);
		const to = Math.min(from + Math.max(finding.length, 0), doc.length);
		const severity =
			finding.severity === "error" || finding.severity === "info"
				? finding.severity
				: "warning";
		diagnostics.push({
			from,
			to,
			message: `${finding.message} (chktex ${finding.code})`,
			severity,
			source: "chktex",
		});
	}
	return diagnostics;
}

/**
 * Async lint source running chktex — the rule catalogue Overleaf and VS Code's
 * LaTeX Workshop use — through Rust on the live buffer (stdin, so findings
 * track the editor rather than the last autosaved snapshot). Any failure
 * degrades to silence: a missing/old chktex must never turn into error
 * popups while typing.
 */
export function texChktexLintSource(
	path: string,
): (view: EditorView) => Promise<Diagnostic[]> {
	return async (view) => {
		try {
			const res = await commands.chktexLint(path, view.state.doc.toString());
			if (!res.ok) return [];
			return chktexDiagnostics(res.data ?? [], view.state.doc);
		} catch {
			return [];
		}
	};
}

/**
 * Extensions for one file: the language plus (for TeX / BibTeX) a custom
 * completion source attached as language data, so `basicSetup`'s
 * autocompletion picks it up without overriding anything.
 */
export function textLanguageExtensions(path: string): Extension[] {
	switch (textLanguageIdForPath(path)) {
		case "json":
			return [json()];
		case "python":
			return [python()];
		case "yaml":
			return [yamlLanguage];
		case "tex":
			return [
				// Overleaf-grammar language pack (highlighting, env auto-close,
				// indent, folding, its own command/env completion via language
				// data). enableAutocomplete stays off because it would install
				// an autocompletion({override}) layer that swallows every other
				// source (the path completion below); autoCloseBrackets /
				// bracket matching already ship with basicSetup. Linting
				// (unmatched environments, unclosed braces, …) and hover
				// command docs are on; `fileName` lets the linter relax its
				// document-env rules on .sty/.cls files.
				latex({
					enableAutocomplete: false,
					enableLinting: true,
					enableTooltips: true,
					autoCloseBrackets: false,
					fileName: basenameOf(path),
				}),
				latexLanguage.data.of({
					autocomplete: texPathCompletionSource(path, listVaultDirForTex),
				}),
				// chktex rules stack on the pack's built-in linter — the lint
				// facet merges sources and runs them together. Slightly above
				// the 750ms default because each run spawns a process (and the
				// facet's delay max() paces the built-in linter too).
				linter(texChktexLintSource(path), { delay: 1000 }),
			];
		case "bib":
			return [
				bibtexLanguage,
				bibtexLanguage.data.of({ autocomplete: bibtexCompletion }),
			];
		default:
			return [];
	}
}
