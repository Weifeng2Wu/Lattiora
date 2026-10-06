import { readCloudReadingActivity } from "@/lib/cloud/reading-activity";
import {
	aggregateReadingHeatmap,
	emptyHeatmap,
} from "@/lib/paper/reading-heatmap/aggregate";
import type {
	ReadingActivityPoint,
	ReadingHeatmap,
} from "@/lib/paper/reading-heatmap/types";

export type ReadingHeatmapBatch = {
	heatmaps: Map<string, ReadingHeatmap>;
	/**
	 * Raw activity points per key — cached by the caller so a later lazy
	 * page-count discovery can re-aggregate without re-reading `marks/`.
	 */
	points: Map<string, ReadingActivityPoint[]>;
};

/** Batch read the original per-mark schemas from the browser working copy. */
async function fetchReadingActivityBatch(
	vaultPath: string,
	rels: string[],
): Promise<Record<string, ReadingActivityPoint[]>> {
	void vaultPath;
	return rels.length ? readCloudReadingActivity(rels) : {};
}

/**
 * Load heatmaps for many papers with a single batch IPC.
 * Keys are vault-relative paper paths (or id when path missing).
 * `opts.pageCounts` (same keys) normalizes bins to the real document extent;
 * papers without a cached count fall back to the max observed page — this
 * function never opens a PDF (page counts are discovered lazily elsewhere).
 */
export async function loadReadingHeatmaps(
	vaultPath: string,
	papers: ReadonlyArray<{ path?: string; id: string }>,
	opts?: { pageCounts?: ReadonlyMap<string, number> },
): Promise<ReadingHeatmapBatch> {
	const heatmaps = new Map<string, ReadingHeatmap>();
	const points = new Map<string, ReadingActivityPoint[]>();
	if (!vaultPath || !papers.length) return { heatmaps, points };

	const keyed: Array<{ key: string; rel: string | null }> = papers.map(
		(paper) => {
			const rel =
				paper.path?.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") || null;
			return { key: rel || paper.id, rel };
		},
	);
	const rels = [...new Set(keyed.flatMap((k) => (k.rel ? [k.rel] : [])))];
	const activity = await fetchReadingActivityBatch(vaultPath, rels);

	for (const { key, rel } of keyed) {
		const pts = (rel ? activity[rel] : undefined) ?? [];
		points.set(key, pts);
		const pageCount = opts?.pageCounts?.get(key);
		heatmaps.set(
			key,
			!pts.length && !pageCount
				? emptyHeatmap()
				: aggregateReadingHeatmap(pts, { pageCount }),
		);
	}
	return { heatmaps, points };
}

export function heatmapCacheKey(paper: { path?: string; id: string }): string {
	const rel = paper.path?.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
	return rel || paper.id;
}
