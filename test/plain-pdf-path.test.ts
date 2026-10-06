import { describe, expect, it } from "vitest";
import { isPlainPdfPath } from "@/lib/workspace/viewer";

describe("isPlainPdfPath", () => {
	it("marks loose vault PDFs as plain", () => {
		expect(isPlainPdfPath("plans/a.pdf")).toBe(true);
		expect(isPlainPdfPath("a.pdf")).toBe(true);
		expect(isPlainPdfPath("/Users/x/vault/plans/a.pdf")).toBe(true);
	});

	it("keeps the full viewer for anything under papers/", () => {
		expect(isPlainPdfPath("papers/2601.00001/paper.pdf")).toBe(false);
		expect(isPlainPdfPath("papers/2601.00001/attachments/fig.pdf")).toBe(false);
		expect(isPlainPdfPath("/Users/x/vault/papers/2601.00001/paper.pdf")).toBe(
			false,
		);
	});

	it("keeps remote arXiv papers on their own behavior", () => {
		expect(isPlainPdfPath("agentero:arxiv:2601.00001")).toBe(false);
	});

	it("null paths are never plain", () => {
		expect(isPlainPdfPath(null)).toBe(false);
	});
});
