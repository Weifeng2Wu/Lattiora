import {
	PdfActionType,
	type PdfBookmarkObject,
	PdfZoomMode,
} from "@embedpdf/models";
import { describe, expect, it } from "vitest";

import { bookmarkPageIndex } from "@/lib/pdf/bookmark";

describe("bookmarkPageIndex", () => {
	it("resolves direct destination bookmarks", () => {
		const bm: PdfBookmarkObject = {
			title: "Chapter 1",
			target: {
				type: "destination",
				destination: {
					pageIndex: 4,
					zoom: { mode: PdfZoomMode.FitPage },
					view: [],
				},
			},
		};
		expect(bookmarkPageIndex(bm)).toBe(4);
	});

	it("resolves GoTo action bookmarks", () => {
		const bm: PdfBookmarkObject = {
			title: "Chapter 2",
			target: {
				type: "action",
				action: {
					type: PdfActionType.Goto,
					destination: {
						pageIndex: 9,
						zoom: { mode: PdfZoomMode.FitPage },
						view: [],
					},
				},
			},
		};
		expect(bookmarkPageIndex(bm)).toBe(9);
	});

	it("returns null for unsupported action types", () => {
		const bm: PdfBookmarkObject = {
			title: "External link",
			target: {
				type: "action",
				action: { type: PdfActionType.URI, uri: "https://example.com" },
			},
		};
		expect(bookmarkPageIndex(bm)).toBeNull();
	});

	it("returns null for bookmarks without a target", () => {
		const bm: PdfBookmarkObject = { title: "Container" };
		expect(bookmarkPageIndex(bm)).toBeNull();
	});
});
