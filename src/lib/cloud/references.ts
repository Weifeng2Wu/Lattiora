import { parseBibtex } from "./bibliography";
import { type CloudPaper, getCloudPaper, listCloudPapers } from "./catalog";
import { cloudLock, localTransaction } from "./db";
import {
	cloudRelative,
	editedFile,
	filesChanged,
	listLocalFiles,
	readLocalFile,
} from "./files";
import type { Citation, CitationMeta, CiteSidecar } from "./reference-types";
import { cloudFetch } from "./sync";

const suffix = "/source/agentero-cite.json";
const arxivId = (value: string) =>
	/(?:arxiv:|arxiv\.org\/(?:abs|pdf)\/)\s*((?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7}))(?:v\d+)?/i.exec(
		value,
	)?.[1];
const doiId = (value: string) =>
	/\b(10\.\d{4,9}\/[^\s{}<>]+?)(?=[\s{}<>]|$)/i
		.exec(value)?.[1]
		?.replace(/[.,;]+$/, "");
const plain = (value: string) =>
	value
		.replace(/\\(?:href|url)\{([^}]+)\}/g, "$1")
		.replace(/\\[a-zA-Z]+\*?/g, "")
		.replace(/[{}]/g, "")
		.replace(/~/g, " ")
		.replace(/\s+/g, " ")
		.trim();
const titleKey = (value: string) =>
	plain(value)
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]/gu, "");
const doiKey = (value: string) =>
	value
		.replace(/^https?:\/\/(?:dx\.)?doi.org\//i, "")
		.trim()
		.toLowerCase();
const arxivKey = (value: string) =>
	value.trim().replace(/v\d+$/, "").toLowerCase();

function bibMetadata(fields: Record<string, string>): CitationMeta {
	return {
		title: fields.title ? plain(fields.title) : undefined,
		authors: fields.author?.split(/\s+and\s+/i).map(plain) ?? [],
		year: /\b(?:19|20)\d{2}\b/.test(fields.year ?? "")
			? Number(/\b(?:19|20)\d{2}\b/.exec(fields.year)?.[0])
			: undefined,
		venue:
			plain(fields.journal || fields.booktitle || fields.journaltitle || "") ||
			undefined,
		doi: fields.doi,
		arxivId: /arxiv/i.test(fields.archiveprefix || fields.eprinttype || "")
			? fields.eprint?.replace(/v\d+$/, "")
			: arxivId(Object.values(fields).join(" ")),
		url: fields.url,
	};
}
function group(text: string, start: number, open: string, close: string) {
	let depth = 1,
		brace = 0,
		index = start + 1;
	for (; index < text.length; index++) {
		const char = text[index];
		if (char === "\\") {
			index++;
			continue;
		}
		if (open !== "{") {
			if (char === "{") brace++;
			if (char === "}") brace--;
		}
		if (brace === 0) {
			if (char === open) depth++;
			if (char === close && --depth === 0) return index + 1;
		}
	}
	return text.length;
}
export function parseBbl(source: string, mode = "bbl"): Citation[] {
	const text = source
		.split(/\r?\n/)
		.filter((line) => !/^\s*%/.test(line))
		.join("\n");
	const starts = [...text.matchAll(/\\bibitem(?![A-Za-z])/g)];
	return starts.map((match, index) => {
		let cursor = match.index + match[0].length;
		while (/\s/.test(text[cursor] ?? "")) cursor++;
		if (text[cursor] === "[") cursor = group(text, cursor, "[", "]");
		while (/\s/.test(text[cursor] ?? "")) cursor++;
		let key: string | undefined;
		if (text[cursor] === "{") {
			const end = group(text, cursor, "{", "}");
			key = text.slice(cursor + 1, end - 1).trim();
			cursor = end;
		}
		const end =
			starts[index + 1]?.index ??
			text.indexOf("\\end{thebibliography}", cursor);
		const rawTex = text.slice(cursor, end < 0 ? undefined : end);
		const raw = [...plain(rawTex)].slice(0, 1200).join("");
		return {
			id: key
				? `cite-${key.replace(/[^a-zA-Z0-9_.:-]/g, "-")}`
				: `ref-${index + 1}`,
			rawKey: key,
			display: `[${index + 1}]`,
			raw,
			metadata: {
				doi: doiId(rawTex),
				arxivId: arxivId(rawTex),
				year: Number(/\b(?:19|20)\d{2}\b/.exec(raw)?.[0]) || undefined,
				url: /https?:\/\/[^\s{}]+/.exec(rawTex)?.[0],
			},
			source: mode,
			status: "unresolved" as const,
		};
	});
}
export function parseLocalReferences(
	files: Array<{ path: string; text: string }>,
): Citation[] {
	const bib = files
		.filter((f) => /\.bib$/i.test(f.path))
		.flatMap((f) => parseBibtex(f.text));
	let ordered = files
		.filter((f) => /\.bbl$/i.test(f.path))
		.flatMap((f) => parseBbl(f.text));
	if (!ordered.length) {
		for (const file of files.filter((f) => /\.(tex|ltx)$/i.test(f.path))) {
			const body =
				/\\begin\{thebibliography\}[\s\S]*?\\end\{thebibliography\}/.exec(
					file.text,
				)?.[0];
			if (body) {
				ordered = parseBbl(body, "tex");
				if (ordered.length) break;
			}
		}
	}
	const seen = new Set<string>();
	if (ordered.length)
		return ordered
			.filter((c) => {
				if (!c.rawKey) return true;
				const key = c.rawKey.toLowerCase();
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			})
			.map((c, index) => {
				const fields = bib.find(
					(b) => b.key.toLowerCase() === c.rawKey?.toLowerCase(),
				);
				const metadata = fields
					? {
							...c.metadata,
							...Object.fromEntries(
								Object.entries(bibMetadata(fields)).filter(
									([, v]) => v != null && (!Array.isArray(v) || v.length),
								),
							),
						}
					: c.metadata;
				return {
					...c,
					display: `[${index + 1}]`,
					metadata,
					status: metadata.title ? "resolved" : "unresolved",
				};
			});
	return bib.map((b, index) => ({
		id: `cite-${b.key.replace(/[^a-zA-Z0-9_.:-]/g, "-") || index}`,
		rawKey: b.key,
		metadata: bibMetadata(b),
		source: "bib",
		status: b.title ? "resolved" : "unresolved",
	}));
}
/** Preserve the original ordered bibliography while enriching each entry at most once. */
export function enrichReferences(
	local: Citation[],
	remote: CitationMeta[],
	provider: string,
): Citation[] {
	const result = local.map((c) => ({ ...c, metadata: { ...c.metadata } }));
	const used = new Set<number>();
	for (const m of remote) {
		const key = titleKey(m.title ?? "");
		const family =
			m.authors?.[0]?.split(/[, ]+/).filter(Boolean).at(-1)?.toLowerCase() ??
			"";
		const index = result.findIndex(
			(c, i) =>
				!used.has(i) &&
				(Boolean(
					c.metadata.doi && m.doi && doiKey(c.metadata.doi) === doiKey(m.doi),
				) ||
					Boolean(
						c.metadata.arxivId &&
							m.arxivId &&
							arxivKey(c.metadata.arxivId) === arxivKey(m.arxivId),
					) ||
					Boolean(
						key.length >= 10 && key === titleKey(c.metadata.title ?? ""),
					) ||
					Boolean(key.length >= 15 && titleKey(c.raw ?? "").includes(key)) ||
					Boolean(
						m.year &&
							c.metadata.year === m.year &&
							family.length >= 3 &&
							c.raw?.toLowerCase().includes(family),
					)),
		);
		if (index < 0) continue;
		used.add(index);
		const c = result[index];
		c.metadata = {
			...c.metadata,
			...Object.fromEntries(
				Object.entries(m).filter(
					([, v]) => v != null && v !== "" && (!Array.isArray(v) || v.length),
				),
			),
			doi: c.metadata.doi ?? m.doi,
			arxivId: c.metadata.arxivId ?? m.arxivId,
			url: c.metadata.url ?? m.url,
		};
		c.source += `+${provider}`;
		c.status = c.metadata.title ? "resolved" : "unresolved";
	}
	return result;
}

export function matchLibraryReferences(
	citations: Citation[],
	papers: CloudPaper[],
	ownPath: string,
): Citation[] {
	const others = papers.filter((p) => p.path !== ownPath);
	return citations.map((c) => {
		const metadata = c.metadata;
		const checks = [
			[
				"doi",
				metadata.doi
					? others.find(
							(p) => p.doi && doiKey(p.doi) === doiKey(metadata.doi ?? ""),
						)
					: undefined,
			],
			[
				"arxiv",
				metadata.arxivId
					? others.find(
							(p) =>
								p.arxiv_id &&
								arxivKey(p.arxiv_id) === arxivKey(metadata.arxivId ?? ""),
						)
					: undefined,
			],
			[
				"title",
				metadata.title && titleKey(metadata.title).length >= 15
					? others.find(
							(p) => titleKey(p.title) === titleKey(metadata.title ?? ""),
						)
					: undefined,
			],
		] as const;
		const found = checks.find(([, paper]) => paper);
		return {
			...c,
			localMatch: found?.[1]
				? { paperPath: found[1].path, matchBy: found[0] }
				: undefined,
		};
	});
}
export async function readCloudReferences(
	path: string,
): Promise<CiteSidecar | null> {
	const rel = cloudRelative(path),
		file = (await listLocalFiles()).find(
			(f) => !f.deleted && f.path === rel + suffix,
		);
	if (!file) return null;
	const value = JSON.parse(
		await (await readLocalFile(file.path)).text(),
	) as CiteSidecar;
	if (value.schemaVersion !== 1 || !Array.isArray(value.citations))
		throw new Error("referencesInvalid");
	return {
		...value,
		citations: matchLibraryReferences(
			value.citations,
			await listCloudPapers(),
			rel,
		),
	};
}
export async function parseCloudReferences(
	path: string,
	force = false,
	signal?: AbortSignal,
): Promise<CiteSidecar> {
	const rel = cloudRelative(path);
	return cloudLock(`references:${rel}`, async () => {
		signal?.throwIfAborted();
		const snapshot = await listLocalFiles();
		const inputs = snapshot
			.filter(
				(f) =>
					!f.deleted &&
					f.path.startsWith(`${rel}/source/`) &&
					/\.(bib|bbl|tex|ltx)$/i.test(f.path) &&
					!/(?:^|\/)(?:node_modules|\.git)\//.test(f.path),
			)
			.sort((a, b) => a.path.localeCompare(b.path));
		if (
			inputs.length > 500 ||
			inputs.reduce((n, f) => n + f.size, 0) > 8 * 1024 * 1024
		)
			throw new Error("referencesTooLarge");
		const paper = await getCloudPaper(rel);
		const texts = await Promise.all(
			inputs.map(async (f) => ({
				path: f.path,
				text: await (await readLocalFile(f.path)).text(),
			})),
		);
		const fingerprint = [
			...new Uint8Array(
				await crypto.subtle.digest(
					"SHA-256",
					new TextEncoder().encode(
						JSON.stringify([
							paper.doi,
							paper.arxiv_id,
							navigator.onLine,
							texts,
						]),
					),
				),
			),
		]
			.map((n) => n.toString(16).padStart(2, "0"))
			.join("");
		const previous = await readCloudReferences(rel);
		if (!force && previous?.source.fingerprint === fingerprint) return previous;
		let citations = parseLocalReferences(texts),
			mode = citations[0]?.source ?? "none";
		if (citations.length > 5000) throw new Error("referencesTooLarge");
		const messages: string[] = [];
		if (navigator.onLine && (paper.doi || paper.arxiv_id)) {
			try {
				const response = await cloudFetch("/api/references", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ doi: paper.doi, arxivId: paper.arxiv_id }),
					signal,
				});
				const remote = (await response.json()) as {
					source: string;
					citations: Array<CitationMeta & { raw?: string }>;
				};
				if (!Array.isArray(remote.citations) || remote.citations.length > 5000)
					throw new Error("referencesInvalid");
				if (!citations.length) {
					citations = remote.citations.map((m, i) => ({
						id: `ref-${i + 1}`,
						raw: m.raw,
						metadata: m,
						source: remote.source,
						status: m.title ? "resolved" : "unresolved",
					}));
					mode = remote.source;
				} else {
					citations = enrichReferences(
						citations,
						remote.citations,
						remote.source,
					);
					if (citations.some((c) => c.source.endsWith(`+${remote.source}`)))
						mode += `+${remote.source}`;
				}
			} catch (error) {
				signal?.throwIfAborted();
				if (!citations.length) throw error;
				messages.push("referencesOnlineUnavailable");
			}
		}
		signal?.throwIfAborted();
		const value: CiteSidecar = {
			schemaVersion: 1,
			source: { mode, generatedAt: new Date().toISOString(), fingerprint },
			citations: matchLibraryReferences(
				citations,
				await listCloudPapers(),
				rel,
			),
			messages,
		};
		const target = rel + suffix;
		await cloudLock("files", () =>
			localTransaction((files) => {
				signal?.throwIfAborted();
				const relevant = (p: string) =>
					p === target ||
					p === `${rel}/.paper.json` ||
					(p.startsWith(`${rel}/source/`) && /\.(bib|bbl|tex|ltx)$/i.test(p));
				const before = new Map(
					snapshot
						.filter((f) => relevant(f.path))
						.map((f) => [f.path, f.localId]),
				);
				for (const [p, f] of files)
					if (relevant(p) && before.get(p) !== f.localId)
						throw new Error("referencesChanged");
				for (const [p, id] of before)
					if (files.get(p)?.localId !== id)
						throw new Error("referencesChanged");
				files.set(
					target,
					editedFile(
						target,
						new Blob([JSON.stringify(value)], { type: "application/json" }),
						files.get(target),
					),
				);
			}),
		);
		filesChanged([target]);
		return value;
	});
}
