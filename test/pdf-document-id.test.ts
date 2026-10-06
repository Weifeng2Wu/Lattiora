import { describe, expect, it } from "vitest";
import {
	embedPdfDocumentId,
	stripEmbedPdfRevision,
} from "@/lib/pdf/document-id";

describe("embedPdfDocumentId", () => {
	it("keeps the base id for url sources without bytes", () => {
		expect(embedPdfDocumentId("tab-1", null)).toBe("tab-1");
		expect(embedPdfDocumentId("tab-1", undefined)).toBe("tab-1");
	});

	it("is stable for the same buffer identity", () => {
		const bytes = new ArrayBuffer(8);
		const first = embedPdfDocumentId("tab-1", bytes);
		expect(embedPdfDocumentId("tab-1", bytes)).toBe(first);
	});

	it("issues a fresh id for a reloaded buffer", () => {
		const before = embedPdfDocumentId("tab-1", new ArrayBuffer(8));
		const after = embedPdfDocumentId("tab-1", new ArrayBuffer(16));
		expect(after).not.toBe(before);
		expect(before.startsWith("tab-1::r")).toBe(true);
		expect(after.startsWith("tab-1::r")).toBe(true);
	});
});

describe("stripEmbedPdfRevision", () => {
	it("returns ids without a revision suffix unchanged", () => {
		expect(stripEmbedPdfRevision("papers/x.pdf")).toBe("papers/x.pdf");
		expect(stripEmbedPdfRevision("papers/x::translation")).toBe(
			"papers/x::translation",
		);
		expect(stripEmbedPdfRevision("headless-layout-m1abc")).toBe(
			"headless-layout-m1abc",
		);
		expect(stripEmbedPdfRevision("x::pane-2")).toBe("x::pane-2");
	});

	it("restores the base id from a suffixed one", () => {
		const bytes = new ArrayBuffer(8);
		const full = embedPdfDocumentId("papers/x.pdf", bytes);
		expect(stripEmbedPdfRevision(full)).toBe("papers/x.pdf");
	});

	it("strips exactly one layer so translation ids keep their suffix", () => {
		expect(stripEmbedPdfRevision("tab::translation::r2")).toBe(
			"tab::translation",
		);
		// A base path legitimately ending in `::r<digits>` survives a single
		// strip of a real revision suffix on top of it.
		expect(stripEmbedPdfRevision("papers/x::r7::r3")).toBe("papers/x::r7");
	});
});
