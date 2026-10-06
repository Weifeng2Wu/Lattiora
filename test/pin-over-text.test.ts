import { describe, expect, it } from "vitest";

import { pinFromRects, pinObscuresBodyText } from "@/lib/pdf/selection/pin";

describe("pinFromRects", () => {
	it("prefers the right side of the selection", () => {
		const rects = [{ x: 0.12, y: 0.3, w: 0.55, h: 0.02 }];
		const pin = pinFromRects(rects);
		expect(pin.side).toBe("right");
		expect(pin.x).toBeGreaterThan(0.12 + 0.55);
	});

	it("flips left when right side covers page text", () => {
		const selection = [{ x: 0.2, y: 0.4, w: 0.15, h: 0.02 }];
		const pageText = [
			{ x: 0.2, y: 0.4, w: 0.15, h: 0.02 },
			{ x: 0.36, y: 0.4, w: 0.3, h: 0.02 },
		];
		const pin = pinFromRects(selection, pageText);
		expect(pin.side).toBe("left");
	});
});

describe("pinObscuresBodyText", () => {
	it("dims when pin footprint covers page glyphs", () => {
		const pin = { x: 0.4, y: 0.41, side: "right" as const };
		const pageText = [{ x: 0.12, y: 0.4, w: 0.55, h: 0.02 }];
		expect(pinObscuresBodyText(pin, pageText)).toBe(true);
	});

	it("stays solid in a free gutter past line end", () => {
		const selection = [{ x: 0.12, y: 0.3, w: 0.55, h: 0.02 }];
		const pageText = [{ x: 0.12, y: 0.3, w: 0.55, h: 0.02 }];
		const pin = pinFromRects(selection, pageText);
		expect(pin.side).toBe("right");
		expect(pinObscuresBodyText(pin, pageText)).toBe(false);
	});

	it("dims mid-line scraps when both sides sit on glyphs", () => {
		const selection = [{ x: 0.65, y: 0.5, w: 0.1, h: 0.018 }];
		const pageText = [{ x: 0.52, y: 0.5, w: 0.4, h: 0.018 }];
		const pin = pinFromRects(selection, pageText);
		expect(pinObscuresBodyText(pin, pageText)).toBe(true);
	});

	it("stays solid when page text is not loaded yet", () => {
		expect(
			pinObscuresBodyText({ x: 0.5, y: 0.4, side: "right" }, undefined),
		).toBe(false);
	});
});
