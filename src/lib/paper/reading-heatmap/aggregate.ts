import {
	EMPTY_READING_HEATMAP,
	READING_HEATMAP_BIN_COUNT,
	type ReadingActivityKind,
	type ReadingActivityPoint,
	type ReadingHeatmap,
} from "@/lib/paper/reading-heatmap/types";

/** Mid-y of normalized rects; defaults to 0.5 when empty. */
export function meanRectY(
	rects: ReadonlyArray<{ y: number; h: number }> | undefined,
): number {
	if (!rects?.length) return 0.5;
	let sum = 0;
	for (const r of rects) {
		sum += r.y + r.h / 2;
	}
	const y = sum / rects.length;
	if (!Number.isFinite(y)) return 0.5;
	return Math.min(1, Math.max(0, y));
}

/**
 * Fractional document position in [0, 1): page progress + in-page y.
 * page is 1-based; pageCount is the document extent.
 */
export function documentPosition(
	page: number,
	y: number,
	pageCount: number,
): number {
	const pages = Math.max(1, Math.floor(pageCount));
	const p = Math.max(1, Math.floor(page));
	const yy = Number.isFinite(y) ? Math.min(1, Math.max(0, y)) : 0.5;
	const pos = (p - 1 + yy) / pages;
	return Math.min(0.999999, Math.max(0, pos));
}

/** Build a fixed-bin heatmap from activity points. */
export function aggregateReadingHeatmap(
	points: readonly ReadingActivityPoint[],
	opts?: { pageCount?: number; binCount?: number },
): ReadingHeatmap {
	const binCount = Math.max(1, opts?.binCount ?? READING_HEATMAP_BIN_COUNT);
	const byKind: Record<ReadingActivityKind, number> = {
		highlight: 0,
		ask: 0,
		translate: 0,
	};

	if (!points.length) {
		return {
			bins: Array.from({ length: binCount }, () => 0),
			total: 0,
			byKind,
			pageCount: Math.max(1, opts?.pageCount ?? 1),
		};
	}

	let maxPage = 1;
	for (const pt of points) {
		if (pt.page > maxPage) maxPage = pt.page;
		byKind[pt.kind] += pt.weight;
	}
	const pageCount = Math.max(maxPage, opts?.pageCount ?? 1, 1);

	const raw = Array.from({ length: binCount }, () => 0);
	let total = 0;
	for (const pt of points) {
		if (pt.weight <= 0) continue;
		const pos = documentPosition(pt.page, pt.y, pageCount);
		const idx = Math.min(binCount - 1, Math.floor(pos * binCount));
		raw[idx] += pt.weight;
		total += pt.weight;
	}

	const peak = raw.reduce((m, v) => (v > m ? v : m), 0);
	const bins =
		peak > 0 ? raw.map((v) => (v > 0 ? v / peak : 0)) : raw.map(() => 0);

	return { bins, total, byKind, pageCount };
}

export function isEmptyHeatmap(h: ReadingHeatmap | null | undefined): boolean {
	return !h || h.total <= 0;
}

/** Merge heatmaps is not needed; use empty constant for missing. */
export function emptyHeatmap(
	binCount = READING_HEATMAP_BIN_COUNT,
): ReadingHeatmap {
	if (binCount === READING_HEATMAP_BIN_COUNT) return EMPTY_READING_HEATMAP;
	return {
		bins: Array.from({ length: binCount }, () => 0),
		total: 0,
		byKind: { highlight: 0, ask: 0, translate: 0 },
		pageCount: 1,
	};
}
