import { describe, expect, it } from "vitest";

import {
	captionRoleFromText,
	resolveCaptionRole,
} from "@/lib/pdf/layout/title-text";
import type { PdfLayoutRegion } from "@/lib/pdf/layout/types";

function cap(
	partial: Partial<PdfLayoutRegion> &
		Pick<PdfLayoutRegion, "id" | "kind" | "bbox">,
): PdfLayoutRegion {
	return {
		pageIndex: 0,
		label: partial.kind,
		score: 0.9,
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

describe("captionRoleFromText", () => {
	it("detects main figure / table / algorithm", () => {
		expect(captionRoleFromText("Figure 7: Components")).toBe("figure_main");
		expect(captionRoleFromText("Fig. 2. Overview")).toBe("figure_main");
		expect(
			captionRoleFromText("Table 2: Observation model input ablation on MSA"),
		).toBe("table_main");
		expect(captionRoleFromText("Algorithm 1 Training")).toBe("algorithm_main");
	});

	it("detects subpanel titles", () => {
		expect(captionRoleFromText("(a) Concentration")).toBe("subpanel");
		expect(captionRoleFromText("(b) Latency scatter")).toBe("subpanel");
		expect(captionRoleFromText("(c) Qualitative examples")).toBe("subpanel");
	});
});

describe("resolveCaptionRole", () => {
	it("uses text over model kind for Table mislabeled as figure_title", () => {
		const r = cap({
			id: "t",
			kind: "figure_title",
			bbox: { x: 0.1, y: 0.5, w: 0.8, h: 0.08 },
			title: "Table 2: Observation model input ablation",
		});
		expect(resolveCaptionRole(r)).toBe("table_main");
	});

	it("leaves unreadable narrow captions ambiguous", () => {
		const r = cap({
			id: "s",
			kind: "figure_title",
			bbox: { x: 0.1, y: 0.4, w: 0.2, h: 0.04 },
		});
		expect(resolveCaptionRole(r)).toBe("other");
	});
});
