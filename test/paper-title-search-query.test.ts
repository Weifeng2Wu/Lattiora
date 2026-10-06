import { describe, expect, it } from "vitest";
import { looksLikeTitleSearchQuery } from "@/lib/paper/lookup";

describe("looksLikeTitleSearchQuery", () => {
	it("treats free-text titles as search queries", () => {
		expect(looksLikeTitleSearchQuery("Attention is all you need")).toBe(true);
		expect(looksLikeTitleSearchQuery("AlphaFold")).toBe(true);
		expect(
			looksLikeTitleSearchQuery("Revisiting 10.1038/nature12373 and friends"),
		).toBe(true);
	});

	it("keeps identifiers and skill sources off the title path", () => {
		expect(looksLikeTitleSearchQuery("1706.03762")).toBe(false);
		expect(looksLikeTitleSearchQuery("10.1038/nature12373")).toBe(false);
		expect(looksLikeTitleSearchQuery("https://arxiv.org/abs/1706.03762")).toBe(
			false,
		);
		expect(looksLikeTitleSearchQuery("1706.03762 10.1038/nature12373")).toBe(
			false,
		);
		expect(
			looksLikeTitleSearchQuery(
				"npx skills add anthropics/skills --skill pptx",
			),
		).toBe(false);
	});
});
