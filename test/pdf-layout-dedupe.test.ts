import { describe, expect, it } from "vitest";

import { bboxIoU, dedupeLayoutRegions } from "@/lib/pdf/layout/dedupe";
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

describe("bboxIoU", () => {
	it("is 1 for identical boxes", () => {
		const b = { x: 0.1, y: 0.1, w: 0.4, h: 0.3 };
		expect(bboxIoU(b, b)).toBeCloseTo(1, 5);
	});

	it("is 0 for non-overlapping boxes", () => {
		expect(
			bboxIoU(
				{ x: 0, y: 0, w: 0.2, h: 0.2 },
				{ x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
			),
		).toBe(0);
	});
});

describe("dedupeLayoutRegions", () => {
	it("keeps only image/table/algorithm candidates that pass score", () => {
		const regions = [
			region({
				id: "low",
				kind: "image",
				score: 0.2,
				bbox: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
			}),
			region({
				id: "ok",
				kind: "table",
				score: 0.8,
				bbox: { x: 0.5, y: 0.5, w: 0.3, h: 0.2 },
			}),
		];
		const out = dedupeLayoutRegions(regions, { minScore: 0.5 });
		expect(out.map((r) => r.id)).toEqual(["ok"]);
	});

	it("suppresses overlapping same-kind boxes (keep higher score)", () => {
		const regions = [
			region({
				id: "a",
				kind: "image",
				score: 0.9,
				bbox: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 },
			}),
			region({
				id: "b",
				kind: "image",
				score: 0.7,
				bbox: { x: 0.15, y: 0.15, w: 0.35, h: 0.35 },
			}),
		];
		const out = dedupeLayoutRegions(regions, { minScore: 0.5 });
		expect(out.map((r) => r.id)).toEqual(["a"]);
	});

	it("keeps different NMS groups even if they overlap", () => {
		const regions = [
			region({
				id: "img",
				kind: "image",
				score: 0.9,
				bbox: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
			}),
			region({
				id: "tbl",
				kind: "table",
				score: 0.85,
				bbox: { x: 0.15, y: 0.15, w: 0.4, h: 0.4 },
			}),
			region({
				id: "alg",
				kind: "algorithm",
				score: 0.8,
				bbox: { x: 0.12, y: 0.12, w: 0.45, h: 0.45 },
			}),
		];
		const out = dedupeLayoutRegions(regions, { minScore: 0.5 });
		expect(out.map((r) => r.id).sort()).toEqual(["alg", "img", "tbl"]);
	});

	it("dedupes image vs chart as one figure class (keep higher score)", () => {
		const regions = [
			region({
				id: "img",
				kind: "image",
				score: 0.7,
				bbox: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
			}),
			region({
				id: "cht",
				kind: "chart",
				score: 0.92,
				bbox: { x: 0.12, y: 0.12, w: 0.48, h: 0.48 },
			}),
		];
		const out = dedupeLayoutRegions(regions, { minScore: 0.5 });
		expect(out.map((r) => r.id)).toEqual(["cht"]);
	});

	it("drops near-contained duplicates", () => {
		const regions = [
			region({
				id: "outer",
				kind: "image",
				score: 0.95,
				bbox: { x: 0.1, y: 0.1, w: 0.6, h: 0.6 },
			}),
			region({
				id: "inner",
				kind: "image",
				score: 0.7,
				bbox: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 },
			}),
		];
		const out = dedupeLayoutRegions(regions, {
			minScore: 0.5,
			containmentThreshold: 0.85,
		});
		expect(out.map((r) => r.id)).toEqual(["outer"]);
	});
});
