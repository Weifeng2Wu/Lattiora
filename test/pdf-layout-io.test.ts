import { describe, expect, it } from "vitest";

import { layoutSidecarPath, parseLayoutSidecar } from "@/lib/pdf/layout/io";

describe("layout sidecar", () => {
	it("stores under the paper source folder", () => {
		expect(layoutSidecarPath("/vault/papers/demo")).toBe(
			"/vault/papers/demo/source/layout.json",
		);
		expect(layoutSidecarPath("C:\\vault\\papers\\demo")).toBe(
			"C:\\vault\\papers\\demo\\source\\layout.json",
		);
	});

	it("parses raw text-enriched layout regions", () => {
		const sidecar = parseLayoutSidecar({
			schemaVersion: 3,
			source: {
				mode: "embedpdf-layout",
				generatedAt: "2026-08-07T00:00:00Z",
			},
			regions: [
				{
					id: "cap",
					pageIndex: 0,
					kind: "figure_title",
					label: "figure_title",
					score: 0.9,
					readingOrder: 1,
					rect: { x: 10, y: 20, w: 30, h: 40 },
					bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
					title: "Figure 1: Demo",
					captionRole: "figure_main",
				},
			],
		});

		expect(sidecar?.regions).toHaveLength(1);
		expect(sidecar?.regions[0]?.title).toBe("Figure 1: Demo");
		expect(sidecar?.regions[0]?.captionRole).toBe("figure_main");
	});

	it("accepts the paddle-layout source mode", () => {
		const sidecar = parseLayoutSidecar({
			schemaVersion: 3,
			source: {
				mode: "paddle-layout",
				generatedAt: "2026-08-12T00:00:00Z",
			},
			regions: [
				{
					id: "paddle-0-0",
					pageIndex: 0,
					kind: "image",
					label: "image",
					score: 0.9,
					readingOrder: 0,
					rect: { x: 10, y: 20, w: 30, h: 40 },
					bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
				},
			],
		});
		expect(sidecar?.source.mode).toBe("paddle-layout");
		expect(sidecar?.regions).toHaveLength(1);
	});

	it("rejects stale schema or malformed regions", () => {
		expect(
			parseLayoutSidecar({
				schemaVersion: 0,
				source: { mode: "embedpdf-layout", generatedAt: "now" },
				regions: [],
			}),
		).toBeNull();
		expect(
			parseLayoutSidecar({
				schemaVersion: 3,
				source: { mode: "embedpdf-layout", generatedAt: "now" },
				regions: [{ id: "x", kind: "unknown" }],
			}),
		).toBeNull();
		// v1 caches predate abstract + full label map — force re-analysis.
		expect(
			parseLayoutSidecar({
				schemaVersion: 1,
				source: { mode: "embedpdf-layout", generatedAt: "now" },
				regions: [],
			}),
		).toBeNull();
	});
});
