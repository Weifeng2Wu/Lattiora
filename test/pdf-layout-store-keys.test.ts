import { afterEach, describe, expect, it } from "vitest";
import {
	clearLayoutDocumentResult,
	clearLayoutVaultState,
	getLayoutDocumentResult,
	layoutAnalysisStore,
	layoutDocumentKey,
	setLayoutDocumentResult,
} from "@/lib/pdf/layout/store";
import type {
	PdfLayoutDocumentResult,
	PdfLayoutRegion,
} from "@/lib/pdf/layout/types";

function region(id: string): PdfLayoutRegion {
	return {
		id,
		pageIndex: 0,
		kind: "text",
		label: "text",
		score: 1,
		readingOrder: 0,
		rect: { x: 0, y: 0, w: 10, h: 10 },
		bbox: { x: 0, y: 0, w: 0.1, h: 0.1 },
	};
}

function result(documentId: string): PdfLayoutDocumentResult {
	return {
		documentId,
		updatedAt: 1,
		regions: [region(`${documentId}-r1`)],
		rawRegions: [region(`${documentId}-raw1`)],
		counts: { text: 1 },
	} as unknown as PdfLayoutDocumentResult;
}

afterEach(() => {
	clearLayoutVaultState();
});

describe("layoutDocumentKey", () => {
	it("strips the buffer revision but keeps translation suffixes", () => {
		expect(layoutDocumentKey("papers/x.pdf::r1")).toBe("papers/x.pdf");
		expect(layoutDocumentKey("papers/x.pdf::translation::r2")).toBe(
			"papers/x.pdf::translation",
		);
		expect(layoutDocumentKey("papers/x.pdf")).toBe("papers/x.pdf");
	});
});

describe("layout byDocument keys across buffer revisions", () => {
	it("stores a revisioned write under the base id and reads it from any form", () => {
		setLayoutDocumentResult(result("papers/x.pdf::r1"));
		expect(getLayoutDocumentResult("papers/x.pdf")).not.toBeNull();
		expect(getLayoutDocumentResult("papers/x.pdf::r3")).not.toBeNull();
		// The stored entry itself carries the canonical base id.
		const stored = layoutAnalysisStore.getState().byDocument["papers/x.pdf"];
		expect(stored?.documentId).toBe("papers/x.pdf");
	});

	it("does not mutate the caller's result object", () => {
		const input = result("papers/x.pdf::r1");
		setLayoutDocumentResult(input);
		expect(input.documentId).toBe("papers/x.pdf::r1");
	});

	it("lets the translation pane read the pane-seeded result", () => {
		// openTranslationTab seeds the pane under its tab id…
		setLayoutDocumentResult(result("papers/x.pdf::translation"));
		// …while the pane's viewer mounts with its own buffer revision.
		expect(
			getLayoutDocumentResult("papers/x.pdf::translation::r2"),
		).not.toBeNull();
	});

	it("clears by base or revisioned id", () => {
		setLayoutDocumentResult(result("papers/x.pdf::r1"));
		clearLayoutDocumentResult("papers/x.pdf::r2");
		expect(getLayoutDocumentResult("papers/x.pdf")).toBeNull();
	});

	it("keeps headless synthetic ids untouched", () => {
		setLayoutDocumentResult(result("headless-layout-m1abc"));
		expect(getLayoutDocumentResult("headless-layout-m1abc")).not.toBeNull();
	});
});
