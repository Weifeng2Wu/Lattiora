import type { CitingCandidate, CitingScanResult } from "@/lib/paper/refs";
import { loadSettings } from "@/lib/settings";
import { listCloudPapers } from "./catalog";
import {
	normalizeCitingArxiv as arxiv,
	citingIdf,
	normalizeCitingDoi as doi,
	rankCitingCandidates,
} from "./citing-ranking";
import { cloudLock, type LocalFile, localTransaction } from "./db";
import {
	editedFile,
	filesChanged,
	listLocalFiles,
	readLocalFile,
} from "./files";
import { cloudFetch } from "./sync";

const PATH = ".agentero/citing-scan.json";
type S2Paper = {
	paperId: string;
	title?: string;
	publicationDate?: string;
	year?: number;
	externalIds?: { DOI?: string; ArXiv?: string };
	citationCount?: number;
	openAccessPdf?: { url?: string };
	embedding?: { vector?: number[] };
};
type Seed = { s2Id: string; citationCount: number; citing: S2Paper[] };
type Cache = {
	schemaVersion: 1;
	config: string;
	seeds: Record<string, Seed>;
	lastResult: CitingScanResult;
};
const configKey = () =>
	loadSettings().scholar.baseUrl.trim().replace(/\/+$/, "");
async function cached() {
	const file = (await listLocalFiles()).find(
		(f) => f.path === PATH && !f.deleted,
	);
	const raw = file ? await (await readLocalFile(PATH)).text() : null;
	const value = raw ? (JSON.parse(raw) as Cache) : null;
	return {
		raw,
		value:
			value?.schemaVersion === 1 && value.config === configKey() ? value : null,
	};
}
async function request(input: Record<string, unknown>, signal?: AbortSignal) {
	const config = loadSettings().scholar;
	if (!config.baseUrl.trim()) throw new Error("citingNotConfigured");
	return (
		await cloudFetch("/api/citing", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ...config, ...input }),
			signal,
		})
	).json();
}
export async function scanCloudCiting(
	options: { force?: boolean; sinceDays?: number; budget?: number } = {},
	signal?: AbortSignal,
	progress?: (n: number) => void,
): Promise<CitingScanResult> {
	return cloudLock("citing", async () => {
		const initial = await listLocalFiles();
		const signature = (files: LocalFile[]) =>
			JSON.stringify(
				files
					.filter((f) => f.path.endsWith("/.paper.json") || f.path === PATH)
					.map((f) => [f.path, f.localId, f.deleted])
					.sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
			);
		const initialSignature = signature(initial);
		const old = await cached();
		if (!navigator.onLine) {
			if (old.value && !options.force) return old.value.lastResult;
			throw new Error("offline");
		}
		const config = configKey();
		const papers = await listCloudPapers();
		if (papers.length > 2000) throw new Error("citingTooLarge");
		const fingerprint = JSON.stringify(
			papers.map((p) => [p.path, p.doi, p.arxiv_id]),
		);
		const sinceDate = new Date(
			Date.now() - Math.max(0, options.sinceDays ?? 183) * 86400000,
		)
			.toISOString()
			.slice(0, 10);
		const lib = papers.map((p) => ({
			path: p.path,
			arxiv: arxiv(p.arxiv_id ?? ""),
			doi: doi(p.doi ?? ""),
			row: null as S2Paper | null,
		}));
		const query = lib.filter((p) => p.arxiv || p.doi);
		const batch = async (ids: string[]) => {
			const result: Array<S2Paper | null> = [];
			// 100 per request bounds JSON on free-tier Workers; original batch order preserved.
			for (let i = 0; i < ids.length; i += 100) {
				signal?.throwIfAborted();
				result.push(
					...(await request(
						{ operation: "batch", ids: ids.slice(i, i + 100) },
						signal,
					)),
				);
			}
			return result;
		};
		const rows = await batch(
			query.map((p) => (p.arxiv ? `ARXIV:${p.arxiv}` : `DOI:${p.doi}`)),
		);
		query.forEach((p, i) => {
			p.row = rows[i];
		});
		progress?.(5);
		const eligible = lib.filter(
			(p) =>
				p.row?.paperId &&
				typeof p.row.citationCount === "number" &&
				p.row.citationCount > 0 &&
				p.row.citationCount <= 2000,
		);
		const seeds: Record<string, Seed> = {};
		let seedsFetched = 0;
		let totalRows = 0;
		// Eight workers, as in the original. Fail closed on incomplete pages; preserve the prior cache.
		let cursor = 0,
			done = 0;
		const fetched = await Promise.allSettled(
			Array.from({ length: Math.min(8, eligible.length) }, async () => {
				for (;;) {
					const index = cursor++;
					if (index >= eligible.length) return;
					signal?.throwIfAborted();
					const p = eligible[index];
					const row = p.row as S2Paper;
					const previous = old.value?.seeds[p.path];
					if (
						!options.force &&
						previous?.s2Id === row.paperId &&
						previous.citationCount === row.citationCount
					) {
						seeds[p.path] = previous;
					} else {
						const citing: S2Paper[] = [];
						let offset = 0;
						for (;;) {
							const page = (await request(
								{ operation: "citations", id: row.paperId, offset },
								signal,
							)) as { data: Array<{ citingPaper?: S2Paper }>; next?: number };
							citing.push(
								...page.data.flatMap((r) =>
									r.citingPaper?.paperId ? [r.citingPaper] : [],
								),
							);
							totalRows += page.data.length;
							if (totalRows > 20000 || citing.length > 3000)
								throw new Error("citingTooLarge");
							if (page.next == null) break;
							if (
								!Number.isInteger(page.next) ||
								page.next <= offset ||
								page.next > 2000
							)
								throw new Error("citingTooLarge");
							offset = page.next;
						}
						seeds[p.path] = {
							s2Id: row.paperId,
							citationCount: row.citationCount ?? 0,
							citing,
						};
						seedsFetched++;
					}
					done++;
					progress?.(5 + (80 * done) / Math.max(1, eligible.length));
				}
			}),
		);
		const failed = fetched.find(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		);
		if (failed) throw failed.reason;
		const aggregated = new Map<string, { row: S2Paper; paths: Set<string> }>();
		for (const [path, seed] of Object.entries(seeds))
			for (const row of seed.citing) {
				const entry = aggregated.get(row.paperId) ?? {
					row,
					paths: new Set<string>(),
				};
				entry.paths.add(path);
				aggregated.set(row.paperId, entry);
			}
		if (aggregated.size > 10000) throw new Error("citingTooLarge");
		const ownArxiv = new Set(lib.map((p) => p.arxiv).filter(Boolean));
		const ownDoi = new Set(lib.map((p) => p.doi).filter(Boolean));
		for (const id of ownDoi)
			if (id.startsWith("10.48550/arxiv."))
				ownArxiv.add(arxiv(id.slice("10.48550/arxiv.".length)));
		const candidates: CitingCandidate[] = [];
		for (const [s2Id, { row, paths }] of aggregated) {
			const a = arxiv(row.externalIds?.ArXiv ?? ""),
				d = doi(row.externalIds?.DOI ?? "");
			const alias = d.startsWith("10.48550/arxiv.")
				? arxiv(d.slice("10.48550/arxiv.".length))
				: "";
			if (
				(a && ownArxiv.has(a)) ||
				(d && ownDoi.has(d)) ||
				(alias && ownArxiv.has(alias))
			)
				continue;
			const date = row.publicationDate ?? (row.year ? `${row.year}-01-01` : "");
			if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < sinceDate || (!a && !d))
				continue;
			const citedByMine = [...paths].sort();
			candidates.push({
				s2Id,
				title: row.title ?? s2Id,
				date,
				arxivId: a || undefined,
				doi: d || undefined,
				identifier: a ? `arXiv:${a}` : d,
				citedByMine,
				weight: citedByMine.reduce(
					(sum, path) => sum + citingIdf(seeds[path].citationCount),
					0,
				),
				citationCount: row.citationCount ?? 0,
				oaPdfUrl: row.openAccessPdf?.url,
			});
		}
		const vectors = new Map<string, number[]>();
		const candidateRows = await batch(candidates.map((c) => c.s2Id));
		candidateRows.forEach((row, i) => {
			if (row?.embedding?.vector?.length)
				vectors.set(candidates[i].s2Id, row.embedding.vector);
		});
		const refs = lib.flatMap((p) =>
			(p.row?.citationCount ?? 0) <= 2000 && p.row?.embedding?.vector?.length
				? [p.row.embedding.vector]
				: [],
		);
		const ranked = rankCitingCandidates(
			candidates,
			refs,
			vectors,
			Math.min(100, options.budget ?? 20),
		);
		const result: CitingScanResult = {
			generatedAt: new Date().toISOString(),
			sinceDate,
			libraryTotal: papers.length,
			seedsTotal: eligible.length,
			seedsFetched,
			skippedMegaCited: lib.filter((p) => (p.row?.citationCount ?? 0) > 2000)
				.length,
			skippedUncited: lib.filter((p) => p.row?.citationCount === 0).length,
			skippedUnknown: lib.filter((p) => p.row?.citationCount == null).length,
			rawCiting: aggregated.size,
			afterFilters: candidates.length,
			...ranked,
			cancelled: false,
			messages: !refs.length || !vectors.size ? ["citingNoEmbeddings"] : [],
		};
		signal?.throwIfAborted();
		if (
			config !== configKey() ||
			fingerprint !==
				JSON.stringify(
					(await listCloudPapers()).map((p) => [p.path, p.doi, p.arxiv_id]),
				)
		)
			throw new Error("citingInputsChanged");
		const data = new Blob(
			[JSON.stringify({ schemaVersion: 1, config, seeds, lastResult: result })],
			{ type: "application/json" },
		);
		if (data.size > 8 * 1024 * 1024) throw new Error("citingTooLarge");
		await cloudLock("files", () =>
			localTransaction((files) => {
				signal?.throwIfAborted();
				if (initialSignature !== signature([...files.values()]))
					throw new Error("citingInputsChanged");
				files.set(PATH, editedFile(PATH, data, files.get(PATH)));
			}),
		);
		filesChanged([PATH]);
		progress?.(100);
		return result;
	});
}
