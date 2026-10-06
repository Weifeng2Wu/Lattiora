import type { PdfBookmarkObject } from "@embedpdf/models";
import { describe, expect, it } from "vitest";

import {
	flattenOutline,
	formatOutlineLocationPath,
	locationPathForAnnotation,
	outlineLocationLabelForPaper,
	setPaperOutline,
} from "@/lib/pdf/outline-location";

function bookmark(
	title: string,
	pageIndex: number,
	children: PdfBookmarkObject[] = [],
): PdfBookmarkObject {
	return {
		title,
		target: {
			type: "destination",
			destination: { pageIndex, zoom: { mode: "Fit" as never } },
		},
		children,
	} as PdfBookmarkObject;
}

describe("outline location", () => {
	const outline: PdfBookmarkObject[] = [
		bookmark("1 Intro", 0, [
			bookmark("1.1 Background", 1),
			bookmark("1.2 Related", 2),
		]),
		bookmark("2 Method", 4, [
			bookmark("2.1 Setup", 4),
			bookmark("2.2 Training", 6),
		]),
		bookmark("3 Results", 10),
	];

	it("flattens nested bookmarks with 1-based pages", () => {
		const flat = flattenOutline(outline);
		expect(flat.map((e) => [e.titlePath.join("/"), e.page])).toEqual([
			["1 Intro", 1],
			["1 Intro/1.1 Background", 2],
			["1 Intro/1.2 Related", 3],
			["2 Method", 5],
			["2 Method/2.1 Setup", 5],
			["2 Method/2.2 Training", 7],
			["3 Results", 11],
		]);
	});

	it("picks deepest bookmark not after the annotation page", () => {
		expect(locationPathForAnnotation(outline, { page: 1 })).toEqual([
			"1 Intro",
		]);
		expect(locationPathForAnnotation(outline, { page: 2 })).toEqual([
			"1 Intro",
			"1.1 Background",
		]);
		expect(locationPathForAnnotation(outline, { page: 6 })).toEqual([
			"2 Method",
			"2.1 Setup",
		]);
		expect(locationPathForAnnotation(outline, { page: 7 })).toEqual([
			"2 Method",
			"2.2 Training",
		]);
		expect(locationPathForAnnotation(outline, { page: 12 })).toEqual([
			"3 Results",
		]);
	});

	it("returns null for empty outline", () => {
		expect(locationPathForAnnotation([], { page: 3 })).toBeNull();
		expect(formatOutlineLocationPath(null)).toBeNull();
	});

	it("formats display paths", () => {
		expect(formatOutlineLocationPath(["2 Method", "2.2 Training"])).toBe(
			"2 Method › 2.2 Training",
		);
	});

	it("reads from paper outline cache", () => {
		setPaperOutline("/vault/papers/foo", outline);
		expect(outlineLocationLabelForPaper("/vault/papers/foo", { page: 7 })).toBe(
			"2 Method › 2.2 Training",
		);
		expect(
			outlineLocationLabelForPaper("/vault/papers/missing", { page: 1 }),
		).toBeNull();
	});
});
