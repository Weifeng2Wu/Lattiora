/** Original citing.rs IDF + centered SPECTER2 gate + MMR, independent of transport. */
import type { CitingCandidate } from "@/lib/paper/refs";
export const normalizeCitingDoi = (v = "") =>
	v
		.trim()
		.replace(/^https?:\/\/doi\.org\//i, "")
		.toLowerCase();
export const normalizeCitingArxiv = (v = "") =>
	v.trim().replace(/v\d+$/i, "").toLowerCase();
export const citingIdf = (count: number) => 1 / Math.log10(count + 10);
export const unitVector = (v: number[]) => {
	const length = Math.hypot(...v);
	return v.map((n) => (length ? n / length : 0));
};
const dot = (a: number[], b: number[]) =>
	a.reduce((sum, n, i) => sum + n * b[i], 0);
export function rankCitingCandidates(
	candidates: CitingCandidate[],
	refs: number[][],
	vectors: Map<string, number[]>,
	budget = 20,
) {
	const dimension = refs[0]?.length ?? vectors.values().next().value?.length;
	if (
		[...refs, ...vectors.values()].some(
			(v) => !v.length || v.length !== dimension || !v.every(Number.isFinite),
		)
	)
		throw new Error("invalidProviderResponse");
	let similarityThreshold: number | undefined;
	let ranked = candidates.map((c) => ({ ...c }));
	if (refs.length && vectors.size) {
		const all = [...refs, ...vectors.values()].map(unitVector);
		const mean = all[0].map(
			(_, i) => all.reduce((sum, v) => sum + v[i], 0) / all.length,
		);
		const center = (v: number[]) =>
			unitVector(unitVector(v).map((n, i) => n - mean[i]));
		const centered = refs.map(center);
		if (refs.length >= 2) {
			const scores = centered
				.map((v, i) =>
					Math.max(...centered.filter((_, j) => i !== j).map((o) => dot(v, o))),
				)
				.sort((a, b) => a - b);
			similarityThreshold =
				scores[Math.min(scores.length - 1, Math.floor(scores.length * 0.1))];
		}
		ranked = ranked.map((c) => {
			const v = vectors.get(c.s2Id);
			return {
				...c,
				similarity: v
					? Math.max(...centered.map((r) => dot(center(v), r)))
					: undefined,
			};
		});
	}
	const threshold = similarityThreshold;
	if (threshold !== undefined)
		ranked = ranked.filter(
			(c) => c.similarity !== undefined && c.similarity >= threshold,
		);
	const gatePassed = ranked.length;
	const wMax = Math.max(Number.EPSILON, ...ranked.map((c) => c.weight));
	const sMax = Math.max(
		Number.EPSILON,
		...ranked.map((c) => c.similarity ?? 0),
	);
	const scored = ranked
		.map((c) => ({
			c,
			score:
				(0.65 * c.weight) / wMax +
				(0.35 * Math.max(0, c.similarity ?? 0)) / sMax,
		}))
		.sort((a, b) => b.score - a.score || b.c.date.localeCompare(a.c.date))
		.slice(0, 150);
	const picked: typeof scored = [];
	const units = new Map([...vectors].map(([id, v]) => [id, unitVector(v)]));
	while (picked.length < Math.max(1, budget) && scored.length) {
		let best = 0,
			bestValue = -Infinity;
		scored.forEach((entry, i) => {
			const v = units.get(entry.c.s2Id);
			const redundancy = v
				? Math.max(
						0,
						...picked.map((p) => {
							const other = units.get(p.c.s2Id);
							return other ? dot(v, other) : 0;
						}),
					)
				: 0;
			const value = 0.7 * entry.score - 0.3 * redundancy;
			if (value > bestValue) {
				best = i;
				bestValue = value;
			}
		});
		picked.push(...scored.splice(best, 1));
	}
	return {
		candidates: picked.map((p) => p.c),
		gatePassed,
		similarityThreshold,
	};
}
