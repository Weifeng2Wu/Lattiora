import { describe, expect, it } from "vitest";

import {
	isLayoutRegionActivation,
	LAYOUT_REGION_CLICK_MOVE_TOLERANCE_PX,
} from "@/lib/pdf/layout";

const at = (x: number, y: number) => ({ x, y });

describe("PDF layout region click guard", () => {
	it("accepts a click that did not move", () => {
		expect(
			isLayoutRegionActivation({
				detail: 1,
				origin: at(100, 100),
				end: at(100, 100),
			}),
		).toBe(true);
	});

	it("accepts jitter within the tolerance", () => {
		expect(
			isLayoutRegionActivation({
				detail: 1,
				origin: at(100, 100),
				end: at(103, 104),
			}),
		).toBe(true);
	});

	it("rejects a drag past the tolerance", () => {
		expect(
			isLayoutRegionActivation({
				detail: 1,
				origin: at(100, 100),
				end: at(100 + LAYOUT_REGION_CLICK_MOVE_TOLERANCE_PX + 1, 100),
			}),
		).toBe(false);
	});

	it("rejects a text-selection drag across the region", () => {
		expect(
			isLayoutRegionActivation({
				detail: 1,
				origin: at(120, 240),
				end: at(420, 260),
			}),
		).toBe(false);
	});

	it("accepts keyboard activation, which has no pointer origin", () => {
		expect(
			isLayoutRegionActivation({ detail: 0, origin: null, end: at(0, 0) }),
		).toBe(true);
	});

	it("rejects a pointer click with no recorded origin", () => {
		expect(
			isLayoutRegionActivation({ detail: 1, origin: null, end: at(10, 10) }),
		).toBe(false);
	});
});
