import type { PdfGlyphSlim, PdfPageGeometry } from "@embedpdf/models";
import type { FormattedSelection } from "@embedpdf/plugin-selection";
import { describe, expect, it } from "vitest";
import {
	buildTightSelectionRects,
	tightenFormattedSelection,
} from "@/lib/pdf/selection-appearance";

function glyph(
	x: number,
	y: number,
	width = 8,
	height = 20,
	overrides: Partial<PdfGlyphSlim> = {},
): PdfGlyphSlim {
	return {
		x,
		y,
		width,
		height,
		tightX: x + 1,
		tightY: y + 4,
		tightWidth: width - 2,
		tightHeight: height - 8,
		flags: 0,
		...overrides,
	};
}

describe("buildTightSelectionRects", () => {
	it("uses tight glyph bounds and removes whitespace-only phantom rows", () => {
		const geometry: PdfPageGeometry = {
			runs: [
				{
					charStart: 0,
					fontSize: 12,
					rect: { x: 0, y: 0, width: 120, height: 28 },
					glyphs: [
						glyph(0, 0, 120, 28, {
							flags: 2,
							tightX: undefined,
							tightY: undefined,
							tightWidth: undefined,
							tightHeight: undefined,
						}),
					],
				},
				{
					charStart: 1,
					fontSize: 12,
					rect: { x: 10, y: 30, width: 24, height: 20 },
					glyphs: [glyph(10, 30), glyph(18, 30), glyph(26, 30)],
				},
				{
					charStart: 4,
					fontSize: 12,
					rect: { x: 10, y: 55, width: 16, height: 20 },
					glyphs: [glyph(10, 55), glyph(18, 55)],
				},
			],
		};

		expect(
			buildTightSelectionRects(
				geometry,
				{ start: { page: 0, index: 0 }, end: { page: 0, index: 5 } },
				0,
			),
		).toEqual([
			{ origin: { x: 11, y: 34 }, size: { width: 22, height: 12 } },
			{ origin: { x: 11, y: 59 }, size: { width: 14, height: 12 } },
		]);
	});

	it("stops the final row at the last selected glyph", () => {
		const geometry: PdfPageGeometry = {
			runs: [
				{
					charStart: 0,
					fontSize: 12,
					rect: { x: 10, y: 20, width: 40, height: 20 },
					glyphs: Array.from({ length: 5 }, (_, index) =>
						glyph(10 + index * 8, 20),
					),
				},
			],
		};

		expect(
			buildTightSelectionRects(
				geometry,
				{ start: { page: 0, index: 1 }, end: { page: 0, index: 2 } },
				0,
			),
		).toEqual([{ origin: { x: 19, y: 24 }, size: { width: 14, height: 12 } }]);
	});

	it("bridges normal word spacing but does not fill a distant column", () => {
		const geometry: PdfPageGeometry = {
			runs: [
				{
					charStart: 0,
					fontSize: 12,
					rect: { x: 10, y: 20, width: 24, height: 20 },
					glyphs: [glyph(10, 20), glyph(18, 20), glyph(26, 20)],
				},
				{
					charStart: 3,
					fontSize: 12,
					rect: { x: 38, y: 20, width: 16, height: 20 },
					glyphs: [glyph(38, 20), glyph(46, 20)],
				},
				{
					charStart: 5,
					fontSize: 12,
					rect: { x: 120, y: 20, width: 16, height: 20 },
					glyphs: [glyph(120, 20), glyph(128, 20)],
				},
			],
		};

		expect(
			buildTightSelectionRects(
				geometry,
				{ start: { page: 0, index: 0 }, end: { page: 0, index: 6 } },
				0,
			),
		).toEqual([
			{ origin: { x: 11, y: 24 }, size: { width: 42, height: 12 } },
			{ origin: { x: 121, y: 24 }, size: { width: 14, height: 12 } },
		]);
	});

	it("does not merge backward fragments that have large negative gaps", () => {
		const geometry: PdfPageGeometry = {
			runs: [
				{
					charStart: 0,
					fontSize: 12,
					rect: { x: 150, y: 20, width: 24, height: 20 },
					glyphs: [glyph(150, 20), glyph(158, 20)],
				},
				{
					charStart: 2,
					fontSize: 12,
					rect: { x: 20, y: 20, width: 24, height: 20 },
					glyphs: [glyph(20, 20), glyph(28, 20)],
				},
			],
		};

		expect(
			buildTightSelectionRects(
				geometry,
				{ start: { page: 0, index: 0 }, end: { page: 0, index: 3 } },
				0,
			),
		).toEqual([
			{ origin: { x: 151, y: 24 }, size: { width: 14, height: 12 } },
			{ origin: { x: 21, y: 24 }, size: { width: 14, height: 12 } },
		]);
	});
});

describe("tightenFormattedSelection", () => {
	it("tightens loose formatted selection bounds and updates bounding rect", () => {
		const rawPages: FormattedSelection[] = [
			{
				pageIndex: 0,
				rect: { origin: { x: 0, y: 0 }, size: { width: 200, height: 100 } },
				segmentRects: [
					{ origin: { x: 0, y: 0 }, size: { width: 200, height: 100 } },
				],
			},
		];
		const geometry: PdfPageGeometry = {
			runs: [
				{
					charStart: 0,
					fontSize: 12,
					rect: { x: 10, y: 20, width: 40, height: 20 },
					glyphs: [glyph(10, 20), glyph(18, 20)],
				},
			],
		};

		const tightened = tightenFormattedSelection(
			rawPages,
			{ 0: geometry },
			{ start: { page: 0, index: 0 }, end: { page: 0, index: 1 } },
		);

		expect(tightened).toEqual([
			{
				pageIndex: 0,
				rect: { origin: { x: 11, y: 24 }, size: { width: 14, height: 12 } },
				segmentRects: [
					{ origin: { x: 11, y: 24 }, size: { width: 14, height: 12 } },
				],
			},
		]);
	});

	it("preserves raw pages when geometry is unavailable", () => {
		const rawPages: FormattedSelection[] = [
			{
				pageIndex: 0,
				rect: { origin: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
				segmentRects: [
					{ origin: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
				],
			},
		];
		expect(
			tightenFormattedSelection(rawPages, undefined, {
				start: { page: 0, index: 0 },
				end: { page: 0, index: 1 },
			}),
		).toEqual(rawPages);
	});
});
