import { getKatexHtml } from "@/lib/math/katex-cache";

// A deliberately small, non-executing LaTeX subset. Only generated markup and
// trust:false KaTeX output reach the DOM; all author text is escaped.
const escapeHtml = (text: string) =>
	text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const raw = (text: string) => `<code>${escapeHtml(text)}</code>`;
const formats: Record<string, string> = {
	textbf: "strong",
	textit: "em",
	emph: "em",
	texttt: "code",
	underline: "u",
	chapter: "h1",
	section: "h2",
	subsection: "h3",
	subsubsection: "h4",
	paragraph: "h5",
};
const mathEnvironments = new Set([
	"math",
	"displaymath",
	"equation",
	"equation*",
	"align",
	"align*",
	"alignat",
	"alignat*",
	"gather",
	"gather*",
]);

/** Balanced arguments, including nested formatting and escaped braces. */
function group(source: string, from: number, open = "{", close = "}") {
	let start = from;
	while (/\s/.test(source[start] ?? "") && start < source.length) start++;
	if (source[start] !== open) return null;
	let depth = 1;
	for (let i = start + 1; i < source.length; i++) {
		if (source[i] === "\\") {
			i++;
			continue;
		}
		if (source[i] === "%") {
			i = source.indexOf("\n", i);
			if (i < 0) break;
			continue;
		}
		if (source[i] === open) depth++;
		if (source[i] === close && --depth === 0) {
			return { text: source.slice(start + 1, i), end: i + 1, closed: true };
		}
	}
	return { text: source.slice(start + 1), end: source.length, closed: false };
}

function math(source: string, displayMode: boolean) {
	if (source.length > 20_000) return raw(source);
	try {
		return getKatexHtml(source.replace(/\\label\s*\{[^{}]*\}/g, ""), {
			displayMode,
			throwOnError: true,
			trust: false,
			strict: "ignore",
			output: "htmlAndMathml",
		});
	} catch {
		// Incomplete input is normal while typing; keep its exact text visible.
		return raw(source);
	}
}

/** Find a delimiter outside escaped characters and comments. */
function closing(source: string, from: number, delimiter: string) {
	for (let i = from; i < source.length; i++) {
		if (source.startsWith(delimiter, i)) return i;
		if (source[i] === "\\") i++;
		else if (source[i] === "%") {
			i = source.indexOf("\n", i);
			if (i < 0) return -1;
		}
	}
	return -1;
}

function environmentEnd(source: string, from: number, name: string) {
	const begin = `\\begin{${name}}`;
	const end = `\\end{${name}}`;
	if (name === "verbatim") return source.indexOf(end, from);
	let depth = 1;
	for (let i = from; i < source.length; i++) {
		if (source.startsWith(begin, i)) {
			depth++;
			i += begin.length - 1;
		} else if (source.startsWith(end, i)) {
			if (--depth === 0) return i;
			i += end.length - 1;
		} else if (source[i] === "\\") i++;
		else if (source[i] === "%") {
			i = source.indexOf("\n", i);
			if (i < 0) return -1;
		}
	}
	return -1;
}

/** Number only top-level rows; matrix/aligned line breaks stay inside their row. */
function numberedMath(
	source: string,
	environment: string,
	nextNumber: () => string,
	remember: (key: string, value: string) => void,
) {
	const rows: string[] = [];
	const multi = /^(align|alignat|gather)/.test(environment);
	let row = "",
		labels: string[] = [],
		tag: string | null = null;
	let suppressed = false,
		braces = 0,
		environments = 0;
	const flush = () => {
		const number =
			tag ??
			(!suppressed && !environment.endsWith("*") && row.trim()
				? nextNumber()
				: null);
		if (number !== null) {
			for (const label of labels) remember(label, number);
			if (tag === null) row += `\n\\tag{${number}}`;
		} else if (multi) row += "\n\\notag";
		rows.push(row);
		row = "";
		labels = [];
		tag = null;
		suppressed = false;
	};
	for (let i = 0; i < source.length; ) {
		const char = source[i++];
		if (char === "%") {
			const end = source.indexOf("\n", i);
			i = end < 0 ? source.length : end + 1;
			continue;
		}
		if (char !== "\\") {
			if (char === "{") braces++;
			if (char === "}") braces--;
			row += char;
			continue;
		}
		const name = source.slice(i).match(/^[a-zA-Z]+\*?|^./)?.[0] ?? "";
		i += name.length;
		if (name === "\\" && multi && braces === 0 && environments === 0) {
			flush();
			const spacing = group(source, i, "[", "]");
			rows.push(`\\\\${spacing?.closed ? source.slice(i, spacing.end) : ""}`);
			if (spacing?.closed) i = spacing.end;
			continue;
		}
		const arg = ["label", "tag", "tag*"].includes(name)
			? group(source, i)
			: null;
		if (
			(name === "label" || name === "tag" || name === "tag*") &&
			arg?.closed
		) {
			if (name === "label") labels.push(arg.text);
			else {
				tag = arg.text;
				row += `\\${name}{${arg.text}}`;
			}
			i = arg.end;
			continue;
		}
		if (name === "notag" || name === "nonumber") {
			suppressed = true;
			continue;
		}
		if (name === "begin") environments++;
		if (name === "end") environments--;
		row += `\\${name}`;
	}
	flush();
	return rows.join("");
}

export interface TexPreviewOptions {
	bibliographyTitle?: string;
	today?: string;
}

export const TEX_PREVIEW_MAX_LENGTH = 500_000;

export function renderTexPreview(
	source: string,
	options: TexPreviewOptions = {},
): string {
	if (source.length > TEX_PREVIEW_MAX_LENGTH) return "";
	let metadata: Record<string, string> = {};
	const labels = new Map<string, string>();
	const citations = new Map<string, string>();
	let collecting = true;
	let equation = 0,
		bibliography = 0;
	let sections = [0, 0, 0];
	let currentLabel: string | null = null;
	let footnotes: string[] = [],
		thanks: string[] = [];
	const remember = (key: string, value: string) => {
		if (collecting) labels.set(key, value);
	};

	function render(
		text: string,
		depth = 0,
		list: boolean | "bibliography" = false,
	): string {
		if (depth > 32) return raw(text);
		let html = "";
		let itemOpen = false;
		let preamble = /^\s*(?:%[^\n]*\n\s*)*\\documentclass\b/.test(text);
		for (let i = 0; i < text.length; ) {
			const start = i;
			const char = text[i++];
			if (char === "%") {
				const end = text.indexOf("\n", i);
				i = end < 0 ? text.length : end + 1;
				continue;
			}
			if (char === "$" || (char === "\\" && /[([]/.test(text[i] ?? ""))) {
				const delimiter =
					char === "$" ? (text[i] === "$" ? "$$" : "$") : `\\${text[i]}`;
				i = start + delimiter.length;
				const endDelimiter =
					delimiter === "\\(" ? "\\)" : delimiter === "\\[" ? "\\]" : delimiter;
				const end = closing(text, i, endDelimiter);
				if (end < 0) {
					if (!preamble) html += raw(text.slice(start));
					break;
				}
				if (!preamble)
					html += collecting
						? ""
						: math(
								text.slice(i, end),
								delimiter !== "$" && delimiter !== "\\(",
							);
				i = end + endDelimiter.length;
				continue;
			}
			if (char !== "\\") {
				if (preamble) continue;
				const arg = char === "{" ? group(text, start) : null;
				if (arg) {
					if (!arg.closed) {
						html += raw(text.slice(start));
						break;
					}
					html += render(arg.text, depth + 1);
					i = arg.end;
				} else if (char === "~") html += "&nbsp;";
				else if (char === "\n" && /^\s*\n/.test(text.slice(i))) {
					html += '<div class="tex-paragraph-break"></div>';
					while (/\s/.test(text[i] ?? "") && i < text.length) i++;
				} else html += escapeHtml(char);
				continue;
			}
			const command = text.slice(i).match(/^[a-zA-Z]+\*?|^./)?.[0] ?? "";
			i += command.length;
			const name = command.replace(/\*$/, "");
			if (name === "verb") {
				const end = text.indexOf(text[i] ?? "\n", i + 1);
				if (!preamble)
					html += raw(end < 0 ? text.slice(start) : text.slice(i + 1, end));
				i = end < 0 ? text.length : end + 1;
				continue;
			}
			const option = group(text, i, "[", "]");
			const arg = group(text, option?.end ?? i);
			if (option?.closed === false || arg?.closed === false) {
				if (!preamble) html += raw(text.slice(start));
				break;
			}
			if ((name === "begin" || name === "end") && arg) {
				i = arg.end;
				if (arg.text === "document") {
					preamble = false;
					if (name === "end") break;
					continue;
				}
				if (preamble) continue;
				if (name === "begin") {
					const endToken = `\\end{${arg.text}}`;
					const end = environmentEnd(text, i, arg.text);
					// Unclosed/unknown environments remain visible instead of disappearing.
					if (end < 0) {
						html += raw(text.slice(start));
						break;
					}
					let body = text.slice(i, end);
					i = end + endToken.length;
					if (mathEnvironments.has(arg.text)) {
						const wrapped = /^(align|alignat|gather)/.test(arg.text);
						currentLabel = null;
						if (
							arg.text !== "math" &&
							arg.text !== "displaymath" &&
							body.length <= 20_000
						) {
							body = numberedMath(
								body,
								arg.text,
								() => String(++equation),
								remember,
							);
						}
						html += collecting
							? ""
							: math(
									wrapped ? `\\begin{${arg.text}}${body}${endToken}` : body,
									arg.text !== "math",
								);
					} else if (arg.text === "thebibliography") {
						const width = group(body, 0);
						if (width?.closed) body = body.slice(width.end);
						bibliography = 0;
						html += `<section class="tex-bibliography">${options.bibliographyTitle ? `<h2>${escapeHtml(options.bibliographyTitle)}</h2>` : ""}<ol>${render(body, depth + 1, "bibliography")}</ol></section>`;
					} else if (arg.text === "itemize" || arg.text === "enumerate") {
						const tag = arg.text === "itemize" ? "ul" : "ol";
						html += `<${tag}>${render(body, depth + 1, true)}</${tag}>`;
					} else if (
						["abstract", "quote", "quotation", "center"].includes(arg.text)
					) {
						html += `<div class="tex-${arg.text}">${render(body, depth + 1)}</div>`;
					} else if (arg.text === "verbatim")
						html += `<pre>${escapeHtml(body)}</pre>`;
					else html += raw(text.slice(start, i));
				} else html += raw(text.slice(start, i));
				continue;
			}
			if (["title", "author", "date"].includes(name) && arg) {
				metadata[name] = arg.text;
				i = arg.end;
				continue;
			}
			if (preamble) {
				i = arg?.end ?? option?.end ?? i;
				continue;
			}
			if (Object.hasOwn(formats, name) && arg) {
				const tag = formats[name];
				const level = ["section", "subsection", "subsubsection"].indexOf(name);
				let prefix = "";
				if (level >= 0 && !command.endsWith("*")) {
					sections[level]++;
					for (let j = level + 1; j < sections.length; j++) sections[j] = 0;
					currentLabel = sections.slice(0, level + 1).join(".");
					prefix = `${currentLabel} `;
				} else if (level >= 0) currentLabel = null;
				html += `<${tag}>${prefix}${render(arg.text, depth + 1)}</${tag}>`;
				i = arg.end;
			} else if (name === "maketitle") {
				if (depth > 0) {
					html += raw("\\maketitle");
					continue;
				}
				const title = render(metadata.title ?? "", depth + 1);
				const author = render(metadata.author ?? "", depth + 1);
				const date = metadata.date
					? `<div>${render(metadata.date, depth + 1)}</div>`
					: "";
				html += `<header><h1>${title}</h1>${author}${date}${thanks.length ? `<div class="tex-footnotes">${thanks.join("")}</div>` : ""}</header>`;
			} else if ((name === "thanks" || name === "footnote") && arg) {
				const notes = name === "thanks" ? thanks : footnotes;
				const number = notes.length + 1;
				const marker =
					name === "thanks"
						? (["*", "†", "‡"][number - 1] ?? String(number))
						: String(number);
				notes.push("");
				const previousLabel = currentLabel;
				currentLabel = String(number);
				notes[number - 1] =
					`<div><sup>${marker}</sup> ${render(arg.text, depth + 1)}</div>`;
				currentLabel = previousLabel;
				html += `<sup class="tex-note-marker">${marker}</sup>`;
				i = arg.end;
			} else if (name === "bibitem" && list === "bibliography" && arg) {
				const number = option?.text ?? String(bibliography + 1);
				bibliography++;
				if (collecting) citations.set(arg.text, number);
				currentLabel = number;
				html += `${itemOpen ? "</li>" : ""}<li><span class="tex-bib-label">[${escapeHtml(number)}]</span> `;
				itemOpen = true;
				i = arg.end;
			} else if (name === "item" && list) {
				html += `${itemOpen ? "</li>" : ""}<li>`;
				itemOpen = true;
				if (option) {
					html += `${render(option.text, depth + 1)} `;
					i = option.end;
				}
			} else if (name === "label" && arg) {
				if (currentLabel !== null) remember(arg.text, currentLabel);
				i = arg.end;
			} else if (
				["cite", "citep", "citet", "ref", "eqref"].includes(name) &&
				arg
			) {
				const isCitation = name.startsWith("cite");
				const value = isCitation
					? arg.text
							.split(",")
							.map((key) => citations.get(key.trim()) ?? key.trim())
							.join(", ")
					: (labels.get(arg.text) ?? arg.text);
				const text = isCitation
					? `[${value}${option ? `, ${option.text}` : ""}]`
					: name === "eqref"
						? `(${value})`
						: value;
				html += `<span class="tex-reference">${escapeHtml(text)}</span>`;
				i = arg.end;
			} else if (name === "LaTeX" || name === "TeX") html += name;
			else if (name === "\\" || name === "newline") html += "<br>";
			else if (name === "today")
				html += options.today ? escapeHtml(options.today) : raw("\\today");
			else if (name === "and" || name === "newblock") html += " ";
			else if (name === "par")
				html += '<div class="tex-paragraph-break"></div>';
			else if (/^[%$&#_{} ]$/.test(name)) html += escapeHtml(name);
			else {
				// Keep unsupported commands AND their arguments visible, including
				// file includes. Never resolve paths, fetch URLs or execute macros.
				i = arg?.end ?? option?.end ?? i;
				let next = group(text, i);
				while (next) {
					i = next.end;
					next = group(text, i);
				}
				html += raw(text.slice(start, i));
			}
		}
		return html + (itemOpen ? "</li>" : "");
	}

	// Resolve forward references without placeholders or a second KaTeX render.
	render(source);
	collecting = false;
	metadata = {};
	equation = 0;
	bibliography = 0;
	sections = [0, 0, 0];
	currentLabel = null;
	footnotes = [];
	thanks = [];
	const html = render(source);
	return (
		html +
		(footnotes.length
			? `<footer class="tex-footnotes">${footnotes.join("")}</footer>`
			: "")
	);
}
