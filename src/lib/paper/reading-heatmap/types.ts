/** Reading heatmap derived from PDF highlights, asks, and translates. */

export type ReadingActivityKind = "highlight" | "ask" | "translate";

export type ReadingActivityPoint = {
	kind: ReadingActivityKind;
	/** 1-based page */
	page: number;
	/** 0–1 vertical position on the page (mid of rects) */
	y: number;
	/** Contribution weight (≥ 0) */
	weight: number;
};

export type ReadingHeatmap = {
	/** Normalized intensities 0–1 along the document (left = start) */
	bins: number[];
	/** Sum of all weights */
	total: number;
	byKind: Record<ReadingActivityKind, number>;
	/** Page extent used for normalization (max observed or known page count) */
	pageCount: number;
};

export const READING_HEATMAP_BIN_COUNT = 24;

export const EMPTY_READING_HEATMAP: ReadingHeatmap = {
	bins: Array.from({ length: READING_HEATMAP_BIN_COUNT }, () => 0),
	total: 0,
	byKind: { highlight: 0, ask: 0, translate: 0 },
	pageCount: 1,
};
