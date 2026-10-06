import type {
	ResolvedLink_Serialize,
	WikiRenameResult,
	WikiSearchCandidate_Serialize,
} from "@/lib/core/bindings";
import { cloudRelative, listLocalFiles, moveLocal } from "./files";
import { readTextFile } from "./fs";

type Document = { path: string; content: string };
const isMarkdown = (path: string) => /\.(md|mdx|markdown)$/i.test(path);
const visible = (path: string) =>
	path !== "Conflicts" &&
	!path.startsWith("Conflicts/") &&
	!path.split("/").some((part) => part.startsWith("."));

export async function workspaceDocuments(): Promise<Document[]> {
	const files = (await listLocalFiles()).filter(
		(f) => !f.deleted && f.mime !== "inode/directory" && visible(f.path),
	);
	return Promise.all(
		files.map(async (f) => ({
			path: f.path,
			content: isMarkdown(f.path) ? await readTextFile(f.path) : "",
		})),
	);
}

type Occurrence = {
	start: number;
	end: number;
	bodyStart: number;
	targetStart: number;
	targetEnd: number;
	body: string;
	syntax: "wikilink" | "markdown";
	embed: boolean;
	line: number;
	context: string;
};

/** Keep exact source spans so renames never round-trip or reformat Markdown. */
export function cloudLinkOccurrences(content: string): Occurrence[] {
	const out: Occurrence[] = [];
	let offset = 0;
	let fence = "";
	const header =
		/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(content)?.[0]
			.length ?? 0;
	for (const line of content.split(/(?<=\n)/)) {
		if (offset < header) {
			offset += line.length;
			continue;
		}
		const opening = line.match(/^\s*(`{3,}|~{3,})/);
		if (opening) {
			if (!fence) fence = opening[1];
			else if (opening[1][0] === fence[0] && opening[1].length >= fence.length)
				fence = "";
			offset += line.length;
			continue;
		}
		if (!fence) {
			const masked = line.replace(/(`+)(.*?)\1/g, (part) =>
				" ".repeat(part.length),
			);
			const re = /(!?)\[\[([^\]\n]+)\]\]|(!?)\[([^\]\n]*)\]\(([^)\n]+)\)/g;
			for (const match of masked.matchAll(re)) {
				if (match.index && masked[match.index - 1] === "\\") continue;
				const wiki = match[2] !== undefined;
				const body = wiki
					? match[2]
					: match[5].startsWith("<")
						? (/^<([^>]+)>/.exec(match[5])?.[1] ?? match[5])
						: match[5].split(/\s+"/)[0];
				if (!wiki && /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(body)) continue;
				const inner = wiki
					? match[0].indexOf("[[") + 2
					: match[0].indexOf("](") + 2;
				const bodyStart =
					offset +
					match.index +
					inner +
					(!wiki && match[5].startsWith("<") ? 1 : 0);
				const suffix = wiki
					? body.search(/[#|]|@(?=[\w-]+(?:\||$))/)
					: body.indexOf("#");
				const length = suffix < 0 ? body.length : suffix;
				out.push({
					start: offset + match.index,
					end: offset + match.index + match[0].length,
					bodyStart,
					targetStart: bodyStart,
					targetEnd: bodyStart + length,
					body,
					syntax: wiki ? "wikilink" : "markdown",
					embed: Boolean(wiki ? match[1] : match[3]),
					line: content.slice(0, offset + match.index).split("\n").length,
					context: line.trim(),
				});
			}
		}
		offset += line.length;
	}
	return out;
}

export async function resolveCloudLink(
	source: string,
	body: string,
	syntax: "wikilink" | "markdown" = "wikilink",
	documents?: Document[],
): Promise<ResolvedLink_Serialize> {
	const { resolveDemoWikiReference } = await import("@/lib/wiki/api");
	const sourceRel = cloudRelative(source);
	const resolved = resolveDemoWikiReference(
		sourceRel,
		body,
		documents || (await workspaceDocuments()),
		syntax,
	);
	return {
		status: resolved.status,
		targetPath: resolved.targetPath,
		candidates: resolved.candidates,
		occurrence: {
			source: sourceRel,
			targetRaw: body.split(/[|#]/)[0],
			syntax,
			embed: false,
			sourceRange: { start: 0, end: new TextEncoder().encode(body).length },
			line: 1,
			fragment: resolved.fragment,
		},
	};
}

export async function cloudDocumentLinks(
	doc: Document,
	documents: Document[],
): Promise<ResolvedLink_Serialize[]> {
	return Promise.all(
		cloudLinkOccurrences(doc.content).map(async (occ) => {
			const link = await resolveCloudLink(
				doc.path,
				occ.body,
				occ.syntax,
				documents,
			);
			return {
				...link,
				occurrence: {
					...link.occurrence,
					embed: occ.embed,
					line: occ.line,
					context: occ.context,
					sourceRange: {
						start: new TextEncoder().encode(doc.content.slice(0, occ.start))
							.length,
						end: new TextEncoder().encode(doc.content.slice(0, occ.end)).length,
					},
				},
			};
		}),
	);
}

export async function cloudBacklinks(path: string) {
	const rel = cloudRelative(path);
	const docs = await workspaceDocuments();
	const links = (
		await Promise.all(
			docs
				.filter((d) => isMarkdown(d.path))
				.map((d) => cloudDocumentLinks(d, docs)),
		)
	).flat();
	return {
		path: rel,
		backlinks: links.filter(
			(l) => l.targetPath === rel && l.status === "resolved",
		),
	};
}

export async function cloudGraphRebuild() {
	const docs = await workspaceDocuments();
	const markdown = docs.filter((d) => isMarkdown(d.path));
	const links = (
		await Promise.all(markdown.map((d) => cloudDocumentLinks(d, docs)))
	).flat();
	return {
		indexedFiles: markdown.length,
		nodes: docs.length,
		edges: links.filter((l) => l.status === "resolved").length,
	};
}

export async function cloudWikiSearch(
	query: string,
	path?: string | null,
	kind?: string | null,
): Promise<WikiSearchCandidate_Serialize[]> {
	const docs = await workspaceDocuments();
	const q = query.trim().toLocaleLowerCase();
	const candidates: WikiSearchCandidate_Serialize[] = [];
	for (const doc of docs) {
		if (path && doc.path !== cloudRelative(path)) continue;
		if (!kind || kind === "file")
			candidates.push({
				kind: "file",
				path: doc.path,
				insertText: doc.path.replace(/\.md$/i, ""),
				label: doc.path.split("/").at(-1) || doc.path,
			});
		if (!kind || kind === "heading" || kind === "block") {
			let fenced = false;
			for (const line of doc.content.split("\n")) {
				if (/^\s*(```|~~~)/.test(line)) {
					fenced = !fenced;
					continue;
				}
				if (fenced) continue;
				const heading = line.match(/^#{1,6}\s+(.+)$/);
				const block = line.match(/\^([\p{L}\p{N}-]+)\s*$/u);
				if (heading && kind !== "block")
					candidates.push({
						kind: "heading",
						path: doc.path,
						insertText: `${doc.path}#${heading[1]}`,
						label: heading[1],
						fragment: { kind: "heading", path: [heading[1]] },
					});
				if (block && kind !== "heading")
					candidates.push({
						kind: "block",
						path: doc.path,
						insertText: `${doc.path}#^${block[1]}`,
						label: block[1],
						fragment: { kind: "block", id: block[1] },
					});
			}
		}
	}
	return candidates
		.filter((c) => `${c.label} ${c.path}`.toLocaleLowerCase().includes(q))
		.slice(0, 100);
}

export async function cloudSearch(query: string, limit = 50) {
	const q = query.trim().toLocaleLowerCase();
	const hits = [];
	if (q)
		for (const doc of await workspaceDocuments()) {
			const markdown = isMarkdown(doc.path);
			const index = doc.content.toLocaleLowerCase().indexOf(q);
			if (index < 0 && !doc.path.toLocaleLowerCase().includes(q)) continue;
			hits.push({
				path: doc.path,
				title:
					doc.content.match(/^#\s+(.+)$/m)?.[1] ||
					doc.path.split("/").at(-1) ||
					doc.path,
				snippet:
					index < 0
						? doc.path
						: doc.content
								.slice(Math.max(0, index - 70), index + q.length + 150)
								.replace(/\s+/g, " "),
				line: index < 0 ? 1 : doc.content.slice(0, index).split("\n").length,
				score: 1,
				paperPath:
					markdown &&
					/\/(?:NOTES|PAPER)\.md$/i.test(doc.path) &&
					doc.path.startsWith("papers/")
						? doc.path.slice(0, doc.path.lastIndexOf("/"))
						: null,
			});
		}
	const max = Math.max(1, Math.min(limit, 200));
	return { hits: hits.slice(0, max), truncated: hits.length > max };
}

function relativeFrom(source: string, target: string): string {
	const from = source.split("/").slice(0, -1);
	const to = target.split("/");
	while (from.length && to.length && from[0] === to[0]) {
		from.shift();
		to.shift();
	}
	return [...from.map(() => ".."), ...to].join("/");
}

/** Preflight exact resolved references; preserve aliases/fragments and unsaved buffers. */
export async function moveCloudPath(
	from: string,
	to: string,
	dirtyPaths: string[] = [],
	options: {
		expectedFiles?: Record<string, string>;
		signal?: AbortSignal;
		renameFiles?: Record<string, string>;
		rewrites?: Array<{ path: string; before: string; after: string }>;
	} = {},
): Promise<WikiRenameResult> {
	const fromRel = cloudRelative(from);
	const toRel = cloudRelative(to);
	const moved = (path: string) =>
		path === fromRel || path.startsWith(`${fromRel}/`);
	const destination = (path: string) =>
		moved(path) ? toRel + path.slice(fromRel.length) : path;
	const docs = await workspaceDocuments();
	const dirty = new Set(dirtyPaths.map(cloudRelative));
	const updates: Array<{ path: string; before: string; after: string }> = [];
	for (const doc of docs.filter((d) => isMarkdown(d.path))) {
		const edits: Array<{ start: number; end: number; text: string }> = [];
		for (const occ of cloudLinkOccurrences(doc.content)) {
			const link = await resolveCloudLink(doc.path, occ.body, occ.syntax, docs);
			if (link.status !== "resolved" || !link.targetPath) continue;
			if (
				!moved(link.targetPath) &&
				!(moved(doc.path) && occ.syntax === "markdown")
			)
				continue;
			const target = destination(link.targetPath);
			edits.push({
				start: occ.targetStart,
				end: occ.targetEnd,
				text:
					occ.syntax === "markdown"
						? relativeFrom(destination(doc.path), target)
						: target.replace(/\.md$/i, ""),
			});
		}
		if ((edits.length || moved(doc.path)) && dirty.has(doc.path))
			throw new Error(`Save the open document before moving: ${doc.path}`);
		if (edits.length) {
			let after = doc.content;
			for (const edit of edits.sort((a, b) => b.start - a.start))
				after = after.slice(0, edit.start) + edit.text + after.slice(edit.end);
			updates.push({ path: destination(doc.path), before: doc.content, after });
		}
	}
	await moveLocal(
		fromRel,
		toRel,
		[...updates, ...(options.rewrites ?? [])],
		options,
	);
	return {
		movedPath: toRel,
		updatedSources: updates.map((u) => u.path),
		skipped: [],
		rollback: "not-needed",
	};
}

/** Read-only projection for the original Markdown embed renderer. */
export async function readCloudEmbed(sourcePath: string, linkText: string) {
	const link = await resolveCloudLink(sourcePath, linkText);
	if (link.status !== "resolved" || !link.targetPath) return { link };
	const path = link.targetPath;
	const fragment = link.occurrence.fragment;
	if (fragment?.kind === "annotation")
		return { link, contentKind: "annotation" as const };
	if (/\.pdf$/i.test(path)) return { link, contentKind: "pdf" as const };
	if (/\.(png|jpe?g|svg|webp|gif|avif)$/i.test(path))
		return { link, contentKind: "image" as const };
	if (!isMarkdown(path)) return { link, contentKind: "unsupported" as const };
	let content = await readTextFile(path);
	const lines = content.split(/\r?\n/);
	if (fragment?.kind === "block") {
		const end = lines.findIndex((line) =>
			line.trimEnd().endsWith(`^${fragment.id}`),
		);
		let start = end;
		while (start > 0 && lines[start - 1].trim()) start--;
		content = lines
			.slice(start, end + 1)
			.join("\n")
			.replace(new RegExp(`\\s*\\^${fragment.id}\\s*$`), "");
	} else if (fragment?.kind === "heading") {
		const key = (text: string) =>
			text.trim().normalize("NFC").toLocaleLowerCase();
		const stack: Array<{ level: number; text: string }> = [];
		let fence = false,
			start = -1,
			end = lines.length,
			level = 0;
		for (let index = 0; index < lines.length; index++) {
			if (/^\s*(```|~~~)/.test(lines[index])) {
				fence = !fence;
				continue;
			}
			if (fence) continue;
			const match = /^\s*(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(lines[index]);
			if (!match) continue;
			if (start >= 0 && match[1].length <= level) {
				end = index;
				break;
			}
			while (stack.length && stack[stack.length - 1].level >= match[1].length)
				stack.pop();
			stack.push({ level: match[1].length, text: match[2] });
			if (
				start < 0 &&
				fragment.path.length <= stack.length &&
				stack
					.slice(-fragment.path.length)
					.every((heading, i) => key(heading.text) === key(fragment.path[i]))
			) {
				start = index;
				level = match[1].length;
			}
		}
		content = start < 0 ? "" : lines.slice(start, end).join("\n");
	}
	return { link, contentKind: "markdown" as const, content };
}
