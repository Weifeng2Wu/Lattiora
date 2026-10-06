import { describe, expect, it } from "vitest";

import {
	bboxArea,
	hoverableLayoutRegions,
	hoverableLayoutRegionsByPage,
	hoverableLayoutRegionsOnPage,
	pickLayoutRegionAtPoint,
	pointInBbox,
} from "@/lib/pdf/layout/hit-test";
import type { PdfLayoutRegion } from "@/lib/pdf/layout/types";

function region(
	partial: Partial<PdfLayoutRegion> &
		Pick<PdfLayoutRegion, "id" | "kind" | "score" | "bbox">,
): PdfLayoutRegion {
	return {
		pageIndex: 0,
		label: partial.kind,
		readingOrder: 0,
		rect: {
			x: partial.bbox.x * 100,
			y: partial.bbox.y * 100,
			w: partial.bbox.w * 100,
			h: partial.bbox.h * 100,
		},
		...partial,
	};
}

describe("layout hit-test", () => {
	it("pointInBbox uses inclusive edges on normalized rects", () => {
		const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
		expect(pointInBbox(0.1, 0.2, box)).toBe(true);
		expect(pointInBbox(0.4, 0.6, box)).toBe(true);
		expect(pointInBbox(0.09, 0.2, box)).toBe(false);
		expect(pointInBbox(0.25, 0.61, box)).toBe(false);
	});

	it("filters to sidebar kinds above the score gate", () => {
		const regions = [
			region({
				id: "fig",
				kind: "image",
				score: 0.9,
				bbox: { x: 0.1, y: 0.1, w: 0.4, h: 0.3 },
			}),
			region({
				id: "body",
				kind: "text",
				score: 0.99,
				bbox: { x: 0.1, y: 0.5, w: 0.8, h: 0.2 },
			}),
			region({
				id: "low",
				kind: "table",
				score: 0.1,
				bbox: { x: 0.5, y: 0.1, w: 0.3, h: 0.2 },
			}),
			region({
				id: "formula",
				kind: "formula",
				score: 0.8,
				bbox: { x: 0.1, y: 0.7, w: 0.5, h: 0.05 },
			}),
		];
		const hoverable = hoverableLayoutRegions(regions);
		expect(hoverable.map((r) => r.id).sort()).toEqual(["fig", "formula"]);
	});

	it("paints larger boxes first so smaller overlays win pointer hits", () => {
		const regions = [
			region({
				id: "small",
				kind: "formula",
				score: 0.7,
				bbox: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 },
			}),
			region({
				id: "big",
				kind: "image",
				score: 0.9,
				bbox: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
			}),
		];
		const ordered = hoverableLayoutRegionsOnPage(regions, 0);
		expect(ordered.map((r) => r.id)).toEqual(["big", "small"]);
		const [first, second] = ordered;
		expect(first).toBeDefined();
		expect(second).toBeDefined();
		if (!first || !second) return;
		expect(bboxArea(first.bbox)).toBeGreaterThan(bboxArea(second.bbox));
	});

	it("prefers the smallest-area region under a point", () => {
		// Different sidebar kinds so NMS does not collapse them first.
		const regions = [
			region({
				id: "outer",
				kind: "image",
				score: 0.5,
				bbox: { x: 0.1, y: 0.1, w: 0.6, h: 0.6 },
			}),
			region({
				id: "inner",
				kind: "formula",
				score: 0.4,
				bbox: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 },
			}),
		];
		const hit = pickLayoutRegionAtPoint(regions, 0, 0.25, 0.25);
		expect(hit?.id).toBe("inner");
	});

	it("breaks area ties with higher score", () => {
		const regions = [
			region({
				id: "a",
				kind: "table",
				score: 0.4,
				bbox: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
			}),
			region({
				id: "b",
				kind: "algorithm",
				score: 0.9,
				bbox: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
			}),
		];
		const hit = pickLayoutRegionAtPoint(regions, 0, 0.2, 0.2);
		expect(hit?.id).toBe("b");
	});

	it("buckets hoverable regions per page, largest first", () => {
		const regions = [
			region({
				id: "p1-small",
				pageIndex: 1,
				kind: "formula",
				score: 0.7,
				bbox: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 },
			}),
			region({
				id: "p1-big",
				pageIndex: 1,
				kind: "image",
				score: 0.9,
				bbox: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
			}),
			region({
				id: "p0-table",
				pageIndex: 0,
				kind: "table",
				score: 0.8,
				bbox: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 },
			}),
			region({
				id: "p2-body",
				pageIndex: 2,
				kind: "text",
				score: 0.99,
				bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 },
			}),
		];
		const byPage = hoverableLayoutRegionsByPage(regions);
		expect(byPage.get(0)?.map((r) => r.id)).toEqual(["p0-table"]);
		expect(byPage.get(1)?.map((r) => r.id)).toEqual(["p1-big", "p1-small"]);
		// Body text is not hoverable, so page 2 has no bucket at all.
		expect(byPage.has(2)).toBe(false);
	});
});
