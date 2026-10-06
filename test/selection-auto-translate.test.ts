import { describe, expect, it } from "vitest";
import type { PdfAskAnchor } from "@/lib/pdf/ask/types";
import { selectionAnchorKey } from "@/lib/pdf/selection";

const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.05 };

const anchor = (over: Partial<PdfAskAnchor> = {}): PdfAskAnchor => ({
	page: 4,
	rects: [rect],
	quote: "a selected sentence",
	trigger: "selection",
	...over,
});

describe("selectionAnchorKey", () => {
	it("returns null without a usable quote so auto-translate is skipped", () => {
		expect(selectionAnchorKey(null)).toBeNull();
		expect(selectionAnchorKey(undefined)).toBeNull();
		expect(selectionAnchorKey(anchor({ quote: "" }))).toBeNull();
		expect(selectionAnchorKey(anchor({ quote: "   " }))).toBeNull();
		expect(selectionAnchorKey(anchor())).not.toBeNull();
	});

	it("ignores surrounding whitespace in the quote", () => {
		expect(selectionAnchorKey(anchor({ quote: "  padded  " }))).toBe(
			selectionAnchorKey(anchor({ quote: "padded" })),
		);
	});

	it("gives a re-placed menu the same key as the original", () => {
		// rePlaceSelectionMenu spreads the previous state, so only `screen`
		// differs between two menu objects of one selection.
		const before = anchor();
		const after = { ...before };
		expect(selectionAnchorKey(after)).toBe(selectionAnchorKey(before));
	});

	it("separates selections that differ in page, rects, quote or trigger", () => {
		const base = selectionAnchorKey(anchor());
		expect(selectionAnchorKey(anchor({ page: 5 }))).not.toBe(base);
		expect(
			selectionAnchorKey(anchor({ rects: [{ ...rect, y: 0.4 }] })),
		).not.toBe(base);
		expect(selectionAnchorKey(anchor({ quote: "other words" }))).not.toBe(base);
		expect(selectionAnchorKey(anchor({ trigger: "dblclick" }))).not.toBe(base);
	});

	it("distinguishes multi-rect selections by rect order", () => {
		const second = { ...rect, y: 0.5 };
		const a = anchor({ rects: [rect, second] });
		const b = anchor({ rects: [second, rect] });
		expect(selectionAnchorKey(a)).not.toBe(selectionAnchorKey(b));
		expect(selectionAnchorKey(a)).toBe(
			selectionAnchorKey(anchor({ rects: [rect, second] })),
		);
	});
});
