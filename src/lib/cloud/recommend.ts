import type {
	RecommendArxivArgs,
	RecommendItem,
	RecommendResult,
} from "@/lib/core/bindings";
import { loadSettings } from "@/lib/settings";
import { listCloudPapers } from "./catalog";
import { cloudLock, localTransaction } from "./db";
import { type FetchedFeed, parseFeed } from "./feed-parser";
import {
	editedFile,
	filesChanged,
	listLocalFiles,
	readLocalFile,
	writeLocalFile,
} from "./files";
import { cloudFetch } from "./sync";

const ROOT = ".agentero/recommend/";
const STATE = `${ROOT}state.json`;
const DEFAULTS = ["cs.AI", "cs.CL", "cs.LG", "cs.CV", "stat.ML"];
type State = { version: 1; config: string; result: RecommendResult };
const configKey = () => {
	const e = loadSettings().embedding;
	return JSON.stringify([e.baseUrl.trim().replace(/\/+$/, ""), e.model.trim()]);
};
async function hash(value: string) {
	return [
		...new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
		),
	]
		.map((n) => n.toString(16).padStart(2, "0"))
		.join("");
}
async function state(): Promise<{ raw: string | null; value: State | null }> {
	const file = (await listLocalFiles()).find(
		(file) => file.path === STATE && !file.deleted,
	);
	if (!file) return { raw: null, value: null };
	const raw = await (await readLocalFile(STATE)).text();
	const value = JSON.parse(raw) as State;
	if (value.version !== 1 || !Array.isArray(value.result?.items))
		throw new Error("recommend.invalid_cache");
	return { raw, value };
}
export async function lastCloudRecommendations(): Promise<RecommendResult | null> {
	const { value } = await state();
	return value?.config === configKey()
		? { ...value.result, reusedCache: true }
		: null;
}
export function recommendationWeights(length: number): number[] {
	const weights = Array.from({ length }, (_, i) => 1 / (1 + Math.log10(i + 1)));
	const total = weights.reduce((sum, n) => sum + n, 0);
	return weights.map((n) => n / total);
}
const normalized = (vector: number[]) => {
	const norm = Math.sqrt(vector.reduce((sum, n) => sum + n * n, 0));
	return norm ? vector.map((n) => n / norm) : vector.map(() => 0);
};
/** Weighted cosine is equivalent to dotting each candidate with a weighted centroid. */
export function rankRecommendations(
	corpus: number[][],
	candidates: number[][],
): number[] {
	const dimension = corpus[0]?.length;
	if (
		!dimension ||
		[...corpus, ...candidates].some(
			(v) => v.length !== dimension || !v.every(Number.isFinite),
		)
	)
		throw new Error("invalidProviderResponse");
	const weights = recommendationWeights(corpus.length);
	const centroid = Array<number>(dimension).fill(0);
	corpus.forEach((v, index) => {
		normalized(v).forEach((n, i) => {
			centroid[i] += n * weights[index];
		});
	});
	return candidates.map((v) =>
		normalized(v).reduce((sum, n, i) => sum + n * centroid[i], 0),
	);
}
const embedText = (title: string, abstract: string) =>
	[...`${title.trim()}\n\n${abstract.trim()}`].slice(0, 4000).join("");

async function vectors(
	texts: string[],
	config: string,
	signal?: AbortSignal,
	progress?: (value: number) => void,
): Promise<number[][]> {
	if (configKey() !== config) throw new Error("recommend.config_changed");
	const modelHash = await hash(config);
	const hashes = await Promise.all(texts.map(hash));
	const prefix = `${ROOT}vectors/${modelHash}/`;
	const local = new Map(
		(await listLocalFiles())
			.filter((file) => !file.deleted && file.path.startsWith(prefix))
			.map((file) => [file.path, file]),
	);
	const byHash = new Map<string, number[]>();
	let vectorBytes = 0;
	const remember = (id: string, vector: number[]) => {
		if (!byHash.has(id)) vectorBytes += vector.length * 8;
		if (vectorBytes > 128 * 1024 * 1024) throw new Error("recommend.too_large");
		byHash.set(id, vector);
	};
	const missing = new Map<string, string>();
	const valid = (v: unknown): v is number[] =>
		Array.isArray(v) &&
		v.length > 0 &&
		v.length <= 8192 &&
		v.every((n) => typeof n === "number" && Number.isFinite(n));
	for (let i = 0; i < hashes.length; i++) {
		const id = hashes[i];
		if (byHash.has(id) || missing.has(id)) continue;
		const file = local.get(`${prefix}${id}.json`);
		const cached = file?.data
			? (JSON.parse(await file.data.text()) as unknown)
			: null;
		if (valid(cached)) remember(id, cached);
		else missing.set(id, texts[i]);
	}
	const entries = [...missing];
	const e = loadSettings().embedding;
	for (let offset = 0; offset < entries.length; offset += 64) {
		signal?.throwIfAborted();
		const batch = entries.slice(offset, offset + 64);
		const response = await cloudFetch("/api/embedding", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				baseUrl: e.baseUrl,
				model: e.model,
				apiKey: e.apiKey,
				input: batch.map(([, text]) => text),
			}),
			signal: signal ?? AbortSignal.timeout(120000),
		});
		const data = (await response.json()) as { vectors: number[][] };
		if (
			!Array.isArray(data.vectors) ||
			data.vectors.length !== batch.length ||
			!data.vectors.every(valid)
		)
			throw new Error("invalidProviderResponse");
		const changed: string[] = [];
		await cloudLock("files", () =>
			localTransaction((files) => {
				for (let i = 0; i < batch.length; i++) {
					const id = batch[i][0],
						vector = data.vectors[i],
						path = `${prefix}${id}.json`;
					remember(id, vector);
					if (!files.get(path) || files.get(path)?.deleted) {
						files.set(
							path,
							editedFile(
								path,
								new Blob([JSON.stringify(vector)], {
									type: "application/json",
								}),
								files.get(path),
							),
						);
						changed.push(path);
					}
				}
			}),
		);
		if (changed.length) filesChanged(changed);
		progress?.(
			20 +
				75 * Math.min(1, (offset + batch.length) / Math.max(1, entries.length)),
		);
	}
	const result = hashes.map((id) => byHash.get(id));
	if (result.some((v) => !v)) throw new Error("invalidProviderResponse");
	return result as number[][];
}
export async function recommendCloudArxiv(
	args: RecommendArxivArgs,
	signal?: AbortSignal,
	progress?: (value: number) => void,
): Promise<RecommendResult> {
	return cloudLock("recommend", async () => {
		const old = await state();
		const config = configKey();
		const requested = args.categories?.length
			? args.categories
			: (old.value?.result.categories ?? DEFAULTS);
		const categories = [
			...new Map(
				requested.map((cat) => [cat.trim().toLowerCase(), cat.trim()]),
			).values(),
		];
		if (
			!categories.length ||
			categories.length > 20 ||
			categories.some(
				(cat) => !/^[a-z][a-z0-9-]*(?:\.[A-Za-z0-9-]+)?$/.test(cat),
			)
		)
			throw new Error("recommend.invalid_categories");
		const previous = old.value;
		const topN = Math.max(1, Math.min(100, args.topN ?? 20));
		if (
			!args.force &&
			previous?.config === config &&
			previous.result.computedAt.startsWith(
				new Date().toISOString().slice(0, 10),
			) &&
			JSON.stringify(previous.result.categories.map((c) => c.toLowerCase())) ===
				JSON.stringify(categories.map((c) => c.toLowerCase())) &&
			previous.result.items.length
		)
			return {
				...previous.result,
				items: previous.result.items.slice(0, topN),
				reusedCache: true,
			};
		const embedding = loadSettings().embedding;
		if (!embedding.baseUrl?.trim() || !embedding.model?.trim())
			throw new Error("recommend.no_embedding");
		if (!navigator.onLine) throw new Error("offline");
		const seen = new Set<string>();
		const corpus = (await listCloudPapers())
			.filter((paper) => {
				if (!paper.abstract?.trim() || seen.has(paper.id)) return false;
				seen.add(paper.id);
				return true;
			})
			.slice(0, 2000);
		if (!corpus.length) throw new Error("recommend.empty_corpus");
		const candidates = new Map<string, RecommendItem>();
		for (const category of categories) {
			const source = (await (
				await cloudFetch("/api/recommend/feed", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ category }),
					signal,
				})
			).json()) as FetchedFeed;
			for (const item of parseFeed(source).items) {
				const match = /^https:\/\/arxiv\.org\/abs\/(.+)$/.exec(
					item.paperUrl ?? "",
				);
				if (!match || !item.title.trim() || !item.summaryText.trim()) continue;
				const arxivId = match[1].replace(/v\d+$/, "");
				if (!candidates.has(arxivId))
					candidates.set(arxivId, {
						arxivId,
						title: item.title,
						abstract: item.summaryText,
						url: item.paperUrl as string,
						publishedAt: item.publishedAt,
						score: null,
					});
			}
			if (candidates.size > 4000) throw new Error("recommend.too_large");
		}
		if (!candidates.size) throw new Error("recommend.no_candidates");
		const items = [...candidates.values()];
		const all = await vectors(
			[
				...corpus.map((paper) => embedText(paper.title, paper.abstract ?? "")),
				...items.map((item) => embedText(item.title, item.abstract)),
			],
			config,
			signal,
			progress,
		);
		const scores = rankRecommendations(
			all.slice(0, corpus.length),
			all.slice(corpus.length),
		);
		const result: RecommendResult = {
			items: items
				.map((item, i) => ({ ...item, score: scores[i] }))
				.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
				.slice(0, topN),
			computedAt: new Date().toISOString(),
			categories,
			corpusSize: corpus.length,
			reusedCache: false,
		};
		signal?.throwIfAborted();
		if (configKey() !== config) throw new Error("recommend.config_changed");
		await writeLocalFile(
			STATE,
			new Blob([JSON.stringify({ version: 1, config, result })], {
				type: "application/json",
			}),
			{ expectedText: old.raw },
		);
		progress?.(100);
		return result;
	});
}
