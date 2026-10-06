import { LAYOUT_SIDEBAR_MIN_SCORE } from "@/lib/pdf/layout/constants";
import { dedupeLayoutRegions } from "@/lib/pdf/layout/dedupe";
import { isSidebarLayoutKind } from "@/lib/pdf/layout/labels";
import { suppressSpuriousFigureDetections } from "@/lib/pdf/layout/merge-captions";
import type { PdfLayoutRegion } from "@/lib/pdf/layout/types";

export function bboxArea(bbox: PdfLayoutRegion["bbox"]): number {
	return Math.max(0, bbox.w) * Math.max(0, bbox.h);
}

/**
 * Same region set as the figures rail: sidebar kinds, min-score + NMS dedupe.
 */
export function hoverableLayoutRegions(
	regions: readonly PdfLayoutRegion[],
	minScore: number = LAYOUT_SIDEBAR_MIN_SCORE,
): PdfLayoutRegion[] {
	const sidebarOnly = regions.filter((r) => isSidebarLayoutKind(r.kind));
	return dedupeLayoutRegions(sidebarOnly, { minScore });
}

function groupByPage(
	regions: readonly PdfLayoutRegion[],
): Map<number, PdfLayoutRegion[]> {
	const byPage = new Map<number, PdfLayoutRegion[]>();
	for (const region of regions) {
		const page = byPage.get(region.pageIndex);
		if (page) page.push(region);
		else byPage.set(region.pageIndex, [region]);
	}
	return byPage;
}

function sortLargestFirst(regions: PdfLayoutRegion[]): PdfLayoutRegion[] {
	return regions.sort((a, b) => bboxArea(b.bbox) - bboxArea(a.bbox));
}

/**
 * Hoverable regions bucketed by page, largest first (paint order: smaller boxes
 * later so they win hits). NMS runs once for the whole document — callers that
 * render many pages must reuse one map instead of deduping per page.
 */
export function hoverableLayoutRegionsByPage(
	regions: readonly PdfLayoutRegion[],
	minScore: number = LAYOUT_SIDEBAR_MIN_SCORE,
): Map<number, PdfLayoutRegion[]> {
	const byPage = groupByPage(hoverableLayoutRegions(regions, minScore));
	for (const page of byPage.values()) sortLargestFirst(page);
	return byPage;
}

/** Regions for one page, largest first. */
export function hoverableLayoutRegionsOnPage(
	regions: readonly PdfLayoutRegion[],
	pageIndex: number,
	minScore: number = LAYOUT_SIDEBAR_MIN_SCORE,
): PdfLayoutRegion[] {
	return hoverableLayoutRegionsByPage(regions, minScore).get(pageIndex) ?? [];
}

/**
 * Debug overlay: pre-merge detections bucketed by page (all kinds, no NMS).
 * Drops boxes below minScore (default 0.3). Largest first so smaller paint on top.
 * Also drops image/chart that are really text/header dual-labels.
 */
export function rawLayoutRegionsByPage(
	regions: readonly PdfLayoutRegion[],
	minScore: number = LAYOUT_SIDEBAR_MIN_SCORE,
): Map<number, PdfLayoutRegion[]> {
	const byPage = groupByPage(
		regions.filter((r) => r.bbox.w > 0 && r.bbox.h > 0 && r.score >= minScore),
	);
	// Suppress needs full-page body blocks at minScore; pass page slice only
	// (body blocks below minScore already excluded — matches Eye gate).
	for (const [pageIndex, page] of byPage) {
		byPage.set(
			pageIndex,
			sortLargestFirst(suppressSpuriousFigureDetections(page)),
		);
	}
	return byPage;
}

/** Pre-merge detections for one page, largest first. */
export function rawLayoutRegionsOnPage(
	regions: readonly PdfLayoutRegion[],
	pageIndex: number,
	minScore: number = LAYOUT_SIDEBAR_MIN_SCORE,
): PdfLayoutRegion[] {
	return rawLayoutRegionsByPage(regions, minScore).get(pageIndex) ?? [];
}

export function pointInBbox(
	x: number,
	y: number,
	bbox: PdfLayoutRegion["bbox"],
): boolean {
	return (
		x >= bbox.x && y >= bbox.y && x <= bbox.x + bbox.w && y <= bbox.y + bbox.h
	);
}

/**
 * Pick the best region under a normalized page point.
 * Prefers the smallest-area hit (most specific); ties break by higher score.
 */
export function pickLayoutRegionAtPoint(
	regions: readonly PdfLayoutRegion[],
	pageIndex: number,
	x: number,
	y: number,
	minScore: number = LAYOUT_SIDEBAR_MIN_SCORE,
): PdfLayoutRegion | null {
	const hits = hoverableLayoutRegions(regions, minScore).filter(
		(r) => r.pageIndex === pageIndex && pointInBbox(x, y, r.bbox),
	);
	if (hits.length === 0) return null;
	hits.sort((a, b) => {
		const areaDiff = bboxArea(a.bbox) - bboxArea(b.bbox);
		if (Math.abs(areaDiff) > 1e-12) return areaDiff;
		return b.score - a.score;
	});
	return hits[0] ?? null;
}
