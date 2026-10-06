import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let embedding = {
	baseUrl: "https://embedding.test/v1",
	model: "vectors",
	apiKey: "********",
};
let feedItems: Array<{
	title: string;
	summaryText: string;
	paperUrl: string;
	publishedAt: null;
}> = [];
vi.mock("../src/lib/settings", () => ({ loadSettings: () => ({ embedding }) }));
vi.mock("../src/lib/cloud/catalog", () => ({
	listCloudPapers: async () => [
		{
			id: "one",
			title: "Vision",
			abstract: "Visual research",
			added_at: "2026-09-30",
		},
		{
			id: "two",
			title: "Language",
			abstract: "Language research",
			added_at: "2026-09-29",
		},
	],
}));
vi.mock("../src/lib/cloud/feed-parser", () => ({
	parseFeed: (source: { body: string }) => JSON.parse(source.body),
}));
beforeEach(() => {
	vi.resetModules();
	embedding = {
		baseUrl: "https://embedding.test/v1",
		model: "vectors",
		apiKey: "********",
	};
	feedItems = [
		{
			title: "Vision candidate",
			summaryText: "Image models",
			paperUrl: "https://arxiv.org/abs/2609.00001",
			publishedAt: null,
		},
		{
			title: "Language candidate",
			summaryText: "Text models",
			paperUrl: "https://arxiv.org/abs/2609.00002",
			publishedAt: null,
		},
	];
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubGlobal("navigator", {
		onLine: true,
		locks: { request: (_name: string, fn: () => unknown) => fn() },
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			if (url.endsWith("/feed"))
				return Response.json({ body: JSON.stringify({ items: feedItems }) });
			const input = JSON.parse(String(init?.body)).input as string[];
			return Response.json({
				vectors: input.map((text) =>
					text.startsWith("Vision") ? [1, 0] : [0, 1],
				),
			});
		}),
	);
});
afterEach(() => vi.unstubAllGlobals());
it("matches original recency-weighted cosine while rejecting mismatched dimensions", async () => {
	const { rankRecommendations, recommendationWeights } = await import(
		"../src/lib/cloud/recommend"
	);
	const weights = recommendationWeights(2);
	expect(weights[0]).toBeGreaterThan(weights[1]);
	expect(weights[0] + weights[1]).toBeCloseTo(1);
	expect(
		rankRecommendations(
			[
				[2, 0],
				[0, 3],
			],
			[
				[5, 0],
				[0, 9],
			],
		),
	).toEqual(weights);
	expect(() => rankRecommendations([[1, 0]], [[1]])).toThrow(
		"invalidProviderResponse",
	);
});
it("ranks actual library abstracts, reuses same-day results offline and shares immutable vector cache across recomputes", async () => {
	const rec = await import("../src/lib/cloud/recommend");
	const args = { vaultPath: "/cloud", categories: ["cs.AI"], force: false };
	const result = await rec.recommendCloudArxiv(args);
	expect(result.items[0].title).toBe("Vision candidate");
	expect(result.corpusSize).toBe(2);
	expect(fetch).toHaveBeenCalledTimes(2);
	Object.defineProperty(navigator, "onLine", {
		value: false,
		configurable: true,
	});
	expect((await rec.recommendCloudArxiv(args)).reusedCache).toBe(true);
	expect((await rec.lastCloudRecommendations())?.items).toEqual(result.items);
	expect(fetch).toHaveBeenCalledTimes(2);
	Object.defineProperty(navigator, "onLine", {
		value: true,
		configurable: true,
	});
	await rec.recommendCloudArxiv({ ...args, force: true });
	expect(fetch).toHaveBeenCalledTimes(3); // Only the feed; no repeated embeddings.
	embedding = { ...embedding, model: "new-vectors" };
	expect(await rec.lastCloudRecommendations()).toBeNull();
	await rec.recommendCloudArxiv(args);
	expect(fetch).toHaveBeenCalledTimes(5);
	const { listLocalFiles } = await import("../src/lib/cloud/files");
	expect((await listLocalFiles()).every((file) => file.dirty)).toBe(true);
});
it("keeps the previous recommendation when a provider fails or configuration changes mid-run", async () => {
	const rec = await import("../src/lib/cloud/recommend");
	const args = { vaultPath: "/cloud", categories: ["cs.AI"] };
	const first = await rec.recommendCloudArxiv(args);
	feedItems.push({
		title: "New candidate",
		summaryText: "New abstract",
		paperUrl: "https://arxiv.org/abs/2609.00003",
		publishedAt: null,
	});
	const original = vi.mocked(fetch).getMockImplementation()!;
	vi.mocked(fetch).mockImplementation(async (url, init) => {
		if (String(url).endsWith("/embedding"))
			throw new Error("providerUnavailable");
		return original(url, init);
	});
	await expect(
		rec.recommendCloudArxiv({ ...args, force: true }),
	).rejects.toThrow("providerUnavailable");
	expect((await rec.lastCloudRecommendations())?.computedAt).toBe(
		first.computedAt,
	);
	vi.mocked(fetch).mockImplementation(async (url, init) => {
		const result = await original(url, init);
		if (String(url).endsWith("/embedding"))
			embedding = { ...embedding, model: "changed" };
		return result;
	});
	await expect(
		rec.recommendCloudArxiv({ ...args, force: true }),
	).rejects.toThrow("recommend.config_changed");
	embedding = { ...embedding, model: "vectors" };
	expect((await rec.lastCloudRecommendations())?.computedAt).toBe(
		first.computedAt,
	);
});
it("preserves the last completed run when cancelled during provider work", async () => {
	const rec = await import("../src/lib/cloud/recommend");
	const args = { vaultPath: "/cloud", categories: ["cs.AI"] };
	const first = await rec.recommendCloudArxiv(args);
	const controller = new AbortController();
	const original = vi.mocked(fetch).getMockImplementation()!;
	vi.mocked(fetch).mockImplementation(async (url, init) => {
		const result = await original(url, init);
		controller.abort();
		return result;
	});
	await expect(
		rec.recommendCloudArxiv({ ...args, force: true }, controller.signal),
	).rejects.toThrow();
	expect((await rec.lastCloudRecommendations())?.computedAt).toBe(
		first.computedAt,
	);
});
