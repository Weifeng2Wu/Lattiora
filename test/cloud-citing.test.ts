import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	citingIdf,
	rankCitingCandidates,
	unitVector,
} from "../src/lib/cloud/citing-ranking";
import type { CitingCandidate } from "../src/lib/paper/refs";

const state = vi.hoisted(() => ({
	papers: [{ path: "papers/self", title: "Seed", arxiv_id: "2501.00001v3" }],
	config: { baseUrl: "https://s2.example/graph/v1", apiKey: "" },
}));
vi.mock("../src/lib/cloud/catalog", () => ({
	listCloudPapers: async () => state.papers,
}));
vi.mock("../src/lib/settings", () => ({
	loadSettings: () => ({ scholar: state.config }),
}));
beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubGlobal("navigator", {
		onLine: true,
		locks: { request: (_k: string, fn: () => unknown) => fn() },
	});
});
afterEach(() => vi.unstubAllGlobals());
const candidate = (id: string, weight: number): CitingCandidate => ({
	s2Id: id,
	title: id,
	date: "2026-09-30",
	identifier: `10.1234/${id}`,
	citedByMine: ["papers/self"],
	weight,
	citationCount: 0,
});
it("ports original IDF and MMR diversity with a fixed import budget", () => {
	expect(citingIdf(189493)).toBeLessThan(0.2);
	expect(citingIdf(0)).toBe(1);
	const ranked = rankCitingCandidates(
		[candidate("a", 1), candidate("b", 0.95), candidate("c", 0.6)],
		[],
		new Map([
			["a", [1, 0]],
			["b", [0.99, 0.01]],
			["c", [0, 1]],
		]),
		2,
	);
	expect(ranked.candidates.map((c) => c.s2Id)).toEqual(["a", "c"]);
});
it("centers SPECTER2 vectors, calibrates against nearest library papers and rejects mismatched dimensions", () => {
	const refs = [
		[1, 0, 0],
		[0.9, 0.1, 0],
		[0, 0, 1],
	].map(unitVector);
	const ranked = rankCitingCandidates(
		[candidate("a", 1), candidate("b", 1)],
		refs,
		new Map([
			["a", [1, 0, 0]],
			["b", [0, 0, 1]],
		]),
	);
	expect(ranked.similarityThreshold).toBeLessThan(0.5);
	expect(ranked.candidates.every((c) => (c.similarity ?? 0) > 0.9)).toBe(true);
	expect(() =>
		rankCitingCandidates([], [[1, 0]], new Map([["x", [1]]])),
	).toThrow("invalidProviderResponse");
});
const seedId = "a".repeat(40),
	newId = "b".repeat(40);
function mockProvider(onRequest?: (input: Record<string, unknown>) => void) {
	const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
		const input = JSON.parse(String(init?.body));
		onRequest?.(input);
		if (input.operation === "batch")
			return Response.json(
				input.ids.map((id: string) =>
					id.startsWith("ARXIV:")
						? { paperId: seedId, citationCount: 1 }
						: { paperId: id },
				),
			);
		return Response.json({
			data: [
				{
					citingPaper: {
						paperId: newId,
						title: "New paper",
						publicationDate: "2026-09-30",
						externalIds: { DOI: "10.1234/new" },
					},
				},
				{
					citingPaper: {
						paperId: "c".repeat(40),
						title: "Already here",
						publicationDate: "2026-09-30",
						externalIds: { DOI: "10.48550/arXiv.2501.00001" },
					},
				},
			],
		});
	});
	vi.stubGlobal("fetch", fetcher);
	return fetcher;
}
it("reuses unchanged seed pages, filters arXiv DOI aliases and reopens cached results offline", async () => {
	const fetcher = mockProvider();
	const { scanCloudCiting } = await import("../src/lib/cloud/citing");
	const first = await scanCloudCiting();
	expect(first.candidates.map((c) => c.title)).toEqual(["New paper"]);
	expect(first.seedsFetched).toBe(1);
	const next = await scanCloudCiting();
	expect(next.seedsFetched).toBe(0);
	expect(
		fetcher.mock.calls.filter(
			([, init]) => JSON.parse(String(init?.body)).operation === "citations",
		),
	).toHaveLength(1);
	Object.defineProperty(navigator, "onLine", { value: false });
	expect(await scanCloudCiting()).toEqual(next);
});
it("preserves the previous cache on provider failure, cancellation and concurrent library change", async () => {
	mockProvider();
	const { scanCloudCiting } = await import("../src/lib/cloud/citing");
	const { readLocalFile } = await import("../src/lib/cloud/files");
	await scanCloudCiting();
	const old = await (await readLocalFile(".agentero/citing-scan.json")).text();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			Response.json({ error: "providerUnavailable" }, { status: 502 }),
		),
	);
	await expect(scanCloudCiting({ force: true })).rejects.toThrow();
	const controller = new AbortController();
	mockProvider(() => controller.abort());
	await expect(
		scanCloudCiting({ force: true }, controller.signal),
	).rejects.toThrow();
	let changed = false;
	mockProvider(() => {
		if (!changed) {
			state.papers.push({
				path: "papers/other",
				title: "Other",
				arxiv_id: "2502.00001",
			});
			changed = true;
		}
	});
	await expect(scanCloudCiting({ force: true })).rejects.toThrow(
		"citingInputsChanged",
	);
	state.papers.pop();
	expect(await (await readLocalFile(".agentero/citing-scan.json")).text()).toBe(
		old,
	);
});
