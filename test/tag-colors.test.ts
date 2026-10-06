import { describe, expect, it } from "vitest";
import {
	coercePaperTags,
	isArxivCategoryLabel,
	isConnectorTagName,
	isInternalTagName,
	normalizePaperTags,
	visiblePaperTags,
} from "@/lib/paper/tags";
import { isTagColorId, tagChipStyle } from "@/lib/ui/tag-colors";

describe("tag colors", () => {
	it("accepts preset ids only", () => {
		expect(isTagColorId("green")).toBe(true);
		expect(isTagColorId("neon")).toBe(false);
	});

	it("normalizes strings and objects with dedupe", () => {
		const tags = normalizePaperTags([
			"  NLP ",
			{ name: "nlp", color: "green" },
			{ name: "survey", color: "red" },
			"",
			{ name: "  ", color: "teal" },
		]);
		expect(tags).toEqual([
			{ name: "NLP", color: "green" },
			{ name: "survey", color: "red" },
		]);
	});

	it("coerces mixed catalog payloads", () => {
		const tags = coercePaperTags([
			"plain",
			{ name: "colored", color: "teal" },
			{ name: "bad", color: "neon" },
			null,
			42,
		]);
		expect(tags).toEqual([
			{ name: "plain" },
			{ name: "colored", color: "teal" },
			{ name: "bad" },
		]);
	});

	it("recognizes and hides connector provenance tags", () => {
		expect(isConnectorTagName("@zotero:survey")).toBe(true);
		expect(isConnectorTagName("survey")).toBe(false);
		expect(visiblePaperTags(["survey", "@zotero:machine learning"])).toEqual([
			{ name: "survey" },
		]);
	});

	it("hides arXiv subject tags as internal provenance", () => {
		expect(isArxivCategoryLabel("Computer Science - Machine Learning")).toBe(
			true,
		);
		expect(isArxivCategoryLabel("Machine Learning")).toBe(false);
		expect(
			isInternalTagName("@arxiv:Computer Science - Machine Learning"),
		).toBe(true);
		expect(isInternalTagName("Computer Science - Machine Learning")).toBe(true);
		expect(
			visiblePaperTags([
				"survey",
				"Computer Science - Machine Learning",
				"@arxiv:Statistics - Machine Learning",
				"@zotero:imported",
			]),
		).toEqual([{ name: "survey" }]);
	});

	it("returns chip styles only for valid colors", () => {
		expect(tagChipStyle(undefined)).toBeUndefined();
		expect(tagChipStyle("green")).toMatchObject({
			backgroundColor: expect.stringContaining("oklch"),
			color: expect.stringContaining("oklch"),
		});
	});
});
