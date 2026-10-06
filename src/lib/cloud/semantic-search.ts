import { z } from "zod";
import type { LocalFile } from "./db";
import { cloudLock, localTransaction } from "./db";
import {
	cachedEmbeddings,
	embeddingConfigKey,
	embeddingVectorPath,
	hashText,
	validEmbeddingVector,
} from "./embedding";
import { editedFile, filesChanged, listLocalFiles } from "./files";

const ROOT = ".agentero/search/";
const chunkSchema = z.object({
	text: z.string().max(2400),
	line: z.number().int().positive(),
	page: z.number().int().positive().optional(),
	vectorPath: z.string(),
});
const indexSchema = z.object({
	version: z.literal(1),
	path: z.string(),
	sourceId: z.string(),
	config: z.string(),
	chunks: z.array(chunkSchema).max(30000),
	partial: z.boolean(),
});
type Index = z.infer<typeof indexSchema>;
export type SemanticHit = {
	id: string;
	path: string;
	text: string;
	line: number;
	page?: number;
	score: number;
};

export function isSearchableFile(file: LocalFile) {
	return (
		!file.deleted &&
		file.mime !== "inode/directory" &&
		file.path !== "Conflicts" &&
		!file.path.startsWith("Conflicts/") &&
		!file.path.split("/").some((part) => part.startsWith(".")) &&
		(/\.(md|mdx|markdown|txt|tex|bib|html?|pdf)$/i.test(file.path) ||
			/\/marks\/[^/]+\.json$/.test(file.path))
	);
}

/** Overlap preserves concepts at chunk boundaries; page markers retain PDF destinations. */
export function chunkSemanticText(
	text: string,
): Array<{ text: string; line: number; page?: number }> {
	const chunks = [];
	const pages = [...text.matchAll(/<!--\s*page\s+(\d+)\s*-->/g)].map(
		(match) => ({ offset: match.index, page: Number(match[1]) }),
	);
	for (let start = 0; start < text.length; ) {
		let end = Math.min(text.length, start + 1800);
		const nextPage = pages.find((page) => page.offset > start);
		if (nextPage && nextPage.offset < end) end = nextPage.offset;
		if (end < text.length && end - start > 1000) {
			const boundary = text.lastIndexOf("\n", end);
			if (boundary > start + 900) end = boundary;
		}
		const value = text
			.slice(start, end)
			.replace(/<!--\s*page\s+\d+\s*-->/g, "")
			.trim();
		if (value)
			chunks.push({
				text: value,
				line: text.slice(0, start).split("\n").length,
				page: pages.filter((page) => page.offset <= start).at(-1)?.page,
			});
		if (chunks.length > 30000) throw new Error("tooLarge");
		if (end === text.length) break;
		start = nextPage?.offset === end ? end : Math.max(start + 1, end - 180);
	}
	return chunks;
}

async function readIndex(file: LocalFile): Promise<Index | null> {
	try {
		return file.data
			? indexSchema.parse(JSON.parse(await file.data.text()))
			: null;
	} catch {
		return null;
	}
}
async function indices(files: LocalFile[], config: string) {
	const sources = new Map(
		files.filter(isSearchableFile).map((file) => [file.path, file]),
	);
	const valid = new Map<string, Index>();
	const vectors = new Map(
		files
			.filter((file) => !file.deleted && file.data)
			.map((file) => [file.path, file]),
	);
	const checked = new Map<string, boolean>();
	const usableVector = async (path: string) => {
		if (checked.has(path)) return checked.get(path);
		let usable = false;
		try {
			const blob = vectors.get(path)?.data;
			usable =
				!!blob &&
				path.startsWith(".agentero/recommend/vectors/") &&
				validEmbeddingVector(JSON.parse(await blob.text()));
		} catch {
			/* Rebuild damaged derived cache. */
		}
		checked.set(path, usable);
		return usable;
	};
	for (const file of files) {
		if (file.deleted || !file.path.startsWith(ROOT)) continue;
		const index = await readIndex(file);
		if (
			index &&
			index.config === config &&
			sources.get(index.path)?.localId === index.sourceId &&
			(
				await Promise.all(
					index.chunks.map((chunk) => usableVector(chunk.vectorPath)),
				)
			).every(Boolean)
		)
			valid.set(index.path, index);
	}
	return { sources, valid };
}
export async function semanticIndexStatus() {
	const { sources, valid } = await indices(
		await listLocalFiles(),
		embeddingConfigKey(),
	);
	return {
		total: sources.size,
		indexed: valid.size,
		partial: [...valid.values()].filter((entry) => entry.partial).length,
		chunks: [...valid.values()].reduce(
			(sum, entry) => sum + entry.chunks.length,
			0,
		),
	};
}

async function sourceText(file: LocalFile, signal: AbortSignal) {
	if (!file.data) throw new Error("notCached");
	if (/\.pdf$/i.test(file.path)) {
		const { extractCloudPdf } = await import("./pdf");
		const result = await extractCloudPdf(file.path, {
			signal,
			allowOcr: false,
		});
		return { text: result.text, partial: result.scannedPages.length > 0 };
	}
	const raw = await file.data.text();
	if (/\/marks\/[^/]+\.json$/.test(file.path)) {
		const value = JSON.parse(raw);
		const texts: string[] = [];
		const visit = (node: unknown, key = "") => {
			if (
				typeof node === "string" &&
				/^(text|content|comment|quote|answerSnapshot|note|question|answer|translation|selectedText)$/.test(
					key,
				)
			)
				texts.push(node);
			else if (Array.isArray(node))
				node.forEach((part) => {
					visit(part);
				});
			else if (node && typeof node === "object")
				for (const [name, part] of Object.entries(node)) visit(part, name);
		};
		visit(value);
		const page = value.page ?? value.anchor?.page;
		return {
			text: `${Number.isInteger(page) && page > 0 ? `<!-- page ${page} -->\n` : ""}${texts.join("\n\n")}`,
			partial: false,
		};
	}
	if (/\.html?$/i.test(file.path)) {
		const doc = new DOMParser().parseFromString(raw, "text/html");
		doc.querySelectorAll("script,style,noscript").forEach((element) => {
			element.remove();
		});
		return { text: doc.body.textContent ?? "", partial: false };
	}
	return { text: raw, partial: false };
}

/** Explicit, incremental indexing. A changed source can never publish an old index. */
export async function buildSemanticIndex(
	signal: AbortSignal,
	progress: (done: number, total: number, path: string) => void,
) {
	return cloudLock("semantic-index", async () => {
		const config = embeddingConfigKey();
		const { sources, valid } = await indices(await listLocalFiles(), config);
		const failures: Array<{ path: string; error: string }> = [];
		let done = 0;
		for (const file of sources.values()) {
			signal.throwIfAborted();
			progress(done, sources.size, file.path);
			if (!valid.has(file.path)) {
				try {
					const source = await sourceText(file, signal);
					const chunks = chunkSemanticText(source.text);
					for (let offset = 0; offset < chunks.length; offset += 16)
						await cachedEmbeddings(
							chunks.slice(offset, offset + 16).map((chunk) => chunk.text),
							config,
							signal,
						);
					const indexedChunks = await Promise.all(
						chunks.map(async (chunk) => ({
							...chunk,
							vectorPath: await embeddingVectorPath(config, chunk.text),
						})),
					);
					signal.throwIfAborted();
					if (config !== embeddingConfigKey())
						throw new Error("recommend.config_changed");
					const path = `${ROOT}${await hashText(file.path)}.json`;
					const entry: Index = {
						version: 1,
						path: file.path,
						sourceId: file.localId,
						config,
						chunks: indexedChunks,
						partial: source.partial,
					};
					await cloudLock("files", () =>
						localTransaction((files) => {
							const current = files.get(file.path);
							if (
								!current ||
								current.deleted ||
								current.localId !== file.localId
							)
								throw new Error("localConflict");
							files.set(
								path,
								editedFile(
									path,
									new Blob([JSON.stringify(entry)], {
										type: "application/json",
									}),
									files.get(path),
								),
							);
						}),
					);
					filesChanged([path]);
				} catch (error) {
					if (signal.aborted) throw error;
					if (config !== embeddingConfigKey()) throw error;
					failures.push({
						path: file.path,
						error: error instanceof Error ? error.message : "requestFailed",
					});
					// A provider outage/configuration error must not repeat a paid request for every file.
					if (failures.length >= 3) break;
				}
			}
			progress(++done, sources.size, file.path);
		}
		return failures;
	});
}

function cosine(a: number[], b: number[]) {
	if (a.length !== b.length || !b.length) return -1;
	let dot = 0,
		aa = 0,
		bb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		aa += a[i] * a[i];
		bb += b[i] * b[i];
	}
	return aa && bb ? dot / Math.sqrt(aa * bb) : -1;
}

export async function searchSemantic(
	query: string,
	signal: AbortSignal,
	prefix = "",
): Promise<SemanticHit[]> {
	if (!query.trim()) return [];
	const config = embeddingConfigKey();
	const files = await listLocalFiles();
	const { valid } = await indices(files, config);
	if (!valid.size) throw new Error("semanticIndexMissing");
	const [vector] = await cachedEmbeddings(
		[query.trim().slice(0, 2000)],
		config,
		signal,
	);
	const byPath = new Map(files.map((file) => [file.path, file]));
	const hits: SemanticHit[] = [];
	for (const index of valid.values()) {
		if (!index.path.startsWith(prefix)) continue;
		for (const [chunkNumber, chunk] of index.chunks.entries()) {
			signal.throwIfAborted();
			const file = byPath.get(chunk.vectorPath);
			if (
				!file?.data ||
				file.deleted ||
				!chunk.vectorPath.startsWith(".agentero/recommend/vectors/")
			)
				continue;
			try {
				const candidate: unknown = JSON.parse(await file.data.text());
				if (
					!Array.isArray(candidate) ||
					candidate.length !== vector.length ||
					!candidate.every((n) => typeof n === "number" && Number.isFinite(n))
				)
					continue;
				const score = cosine(vector, candidate);
				if (score > 0)
					hits.push({
						id: `${index.sourceId}:${chunkNumber}`,
						path: index.path,
						text: chunk.text,
						line: chunk.line,
						page: chunk.page,
						score,
					});
			} catch {
				/* A damaged derived vector is omitted, never treated as evidence. */
			}
		}
	}
	if (config !== embeddingConfigKey())
		throw new Error("recommend.config_changed");
	// Recheck after the request: edits/deletions during query embedding must disappear immediately.
	const current = new Map(
		(await listLocalFiles())
			.filter(isSearchableFile)
			.map((file) => [file.path, file.localId]),
	);
	const counts = new Map<string, number>();
	return hits
		.sort((a, b) => b.score - a.score)
		.filter((hit) => {
			if (current.get(hit.path) !== valid.get(hit.path)?.sourceId) return false;
			const count = (counts.get(hit.path) ?? 0) + 1;
			counts.set(hit.path, count);
			return count <= 3;
		})
		.slice(0, 30);
}
