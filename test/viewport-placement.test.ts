import { describe, expect, it } from "vitest";
import { placeViewportFloating } from "@/lib/core/viewport-placement";

const VIEWPORT = { height: 640, width: 900 };
const EDGE = 8;

describe("placeViewportFloating", () => {
	it("moves a bottom-opening menu above a bottom-edge pointer", () => {
		const placement = placeViewportFloating({
			point: { x: 620, y: 610 },
			element: { height: 280, width: 220 },
			viewport: VIEWPORT,
		});

		expect(placement.side).toBe("top");
		expect(placement.top).toBeGreaterThanOrEqual(EDGE);
		expect(placement.top + 280).toBeLessThanOrEqual(VIEWPORT.height - EDGE);
	});

	it("keeps a bottom-opening menu below its anchor when there is room", () => {
		const placement = placeViewportFloating({
			point: { x: 80, y: 140 },
			element: { height: 220, width: 220 },
			viewport: VIEWPORT,
		});

		expect(placement.side).toBe("bottom");
		expect(placement.top).toBe(140);
		expect(placement.left).toBe(80);
	});

	it("keeps a top-opening listbox below its anchor when space above is exhausted", () => {
		const placement = placeViewportFloating({
			point: { x: 80, y: 90 },
			element: { height: 220, width: 220 },
			viewport: VIEWPORT,
			side: "top",
		});

		expect(placement.side).toBe("bottom");
		expect(placement.top).toBe(90);
	});

	it("clamps an oversized menu to the viewport and preserves scrollable height", () => {
		const placement = placeViewportFloating({
			point: { x: 890, y: 630 },
			element: { height: 1_000, width: 1_000 },
			viewport: VIEWPORT,
		});

		expect(placement.left).toBe(EDGE);
		expect(placement.top).toBe(EDGE);
		expect(placement.maxWidth).toBe(VIEWPORT.width - EDGE * 2);
		expect(placement.maxHeight).toBe(VIEWPORT.height - EDGE * 2);
	});
});
