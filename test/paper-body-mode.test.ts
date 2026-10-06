import { describe, expect, it } from "vitest";
import { paperBodyMode } from "@/lib/workspace/viewer";

describe("paperBodyMode", () => {
	it("renders local or remote pdf assets as pdf", () => {
		expect(paperBodyMode(true, null)).toBe("pdf");
		expect(paperBodyMode(true, "https://arxiv.org/html/2608.13524")).toBe(
			"pdf",
		);
	});

	it("falls back to remote html when no pdf resolved", () => {
		expect(paperBodyMode(false, "https://arxiv.org/html/2608.13524")).toBe(
			"html",
		);
	});

	it("never falls back to a markdown editor — pdf empty state instead", () => {
		expect(paperBodyMode(false, null)).toBe("pdf");
	});
});
