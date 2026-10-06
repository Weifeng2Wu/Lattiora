import { describe, expect, it } from "vitest";
import {
	aggregateReadingHeatmap,
	documentPosition,
	meanRectY,
	READING_HEATMAP_BIN_COUNT,
} from "@/lib/paper/reading-heatmap";

describe("meanRectY", () => {
	it("defaults to 0.5 for empty rects", () => {
		expect(meanRectY([])).toBe(0.5);
		expect(meanRectY(undefined)).toBe(0.5);
	});

	it("uses mid-point of a single rect", () => {
		expect(meanRectY([{ y: 0.2, h: 0.1 }])).toBeCloseTo(0.25);
	});
});

describe("documentPosition", () => {
	it("maps page 1 top to ~0", () => {
		expect(documentPosition(1, 0, 10)).toBeCloseTo(0);
	});

	it("maps last page bottom near 1", () => {
		const p = documentPosition(10, 1, 10);
		expect(p).toBeGreaterThan(0.99);
		expect(p).toBeLessThan(1);
	});

	it("clamps page and y", () => {
		expect(documentPosition(0, -1, 5)).toBeCloseTo(0);
		expect(documentPosition(99, 2, 5)).toBeLessThan(1);
	});
});

describe("aggregateReadingHeatmap", () => {
	it("returns empty bins when no points", () => {
		const h = aggregateReadingHeatmap([]);
		expect(h.total).toBe(0);
		expect(h.bins).toHaveLength(READING_HEATMAP_BIN_COUNT);
		expect(h.bins.every((b) => b === 0)).toBe(true);
	});

	it("concentrates early activity on the left", () => {
		const h = aggregateReadingHeatmap(
			[
				{ kind: "highlight", page: 1, y: 0.1, weight: 1 },
				{ kind: "highlight", page: 1, y: 0.2, weight: 1 },
			],
			{ pageCount: 10, binCount: 10 },
		);
		expect(h.total).toBe(2);
		expect(h.byKind.highlight).toBe(2);
		// First bin should be hottest
		const peak = Math.max(...h.bins);
		expect(h.bins[0]).toBe(peak);
		expect(h.bins[0]).toBe(1);
		expect(h.bins.slice(2).every((b) => b === 0)).toBe(true);
	});

	it("weights asks by dialogue turns", () => {
		const h = aggregateReadingHeatmap(
			[
				{ kind: "ask", page: 5, y: 0.5, weight: 4 },
				{ kind: "translate", page: 5, y: 0.5, weight: 1 },
			],
			{ pageCount: 10, binCount: 10 },
		);
		expect(h.byKind.ask).toBe(4);
		expect(h.byKind.translate).toBe(1);
		expect(h.total).toBe(5);
		const mid = h.bins[4] ?? h.bins[5];
		expect(Math.max(...h.bins)).toBe(1);
		expect(mid).toBeGreaterThan(0);
	});

	it("uses known pageCount even when activity is early", () => {
		const h = aggregateReadingHeatmap(
			[{ kind: "highlight", page: 1, y: 0, weight: 1 }],
			{ pageCount: 20, binCount: 20 },
		);
		expect(h.pageCount).toBe(20);
		expect(h.bins[0]).toBe(1);
		expect(h.bins[10]).toBe(0);
	});
});
