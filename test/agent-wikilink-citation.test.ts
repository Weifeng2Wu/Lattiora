import { describe, expect, it } from "vitest";
import {
	linkifyWikilinks,
	normalizeWikiCitationHref,
	parseWikiCitationBody,
} from "@/lib/agent/wikilink-citation";

describe("parseWikiCitationBody", () => {
	it("parses target and alias", () => {
		expect(parseWikiCitationBody("papers/a/NOTES|short")).toEqual({
			target: "papers/a/NOTES",
			alias: "short",
		});
	});

	it("parses target only", () => {
		expect(parseWikiCitationBody("papers/a/NOTES.md")).toEqual({
			target: "papers/a/NOTES.md",
			alias: undefined,
		});
	});
});

describe("normalizeWikiCitationHref", () => {
	it("appends .md for NOTES/PAPER/README basenames", () => {
		expect(normalizeWikiCitationHref("papers/vla/2504.16054/NOTES")).toBe(
			"papers/vla/2504.16054/NOTES.md",
		);
		expect(normalizeWikiCitationHref("papers/x/PAPER#intro")).toBe(
			"papers/x/PAPER.md#intro",
		);
	});

	it("keeps paper folder paths and existing extensions", () => {
		expect(normalizeWikiCitationHref("papers/vla/2504.16054")).toBe(
			"papers/vla/2504.16054",
		);
		expect(normalizeWikiCitationHref("papers/x/NOTES.md")).toBe(
			"papers/x/NOTES.md",
		);
	});
});

describe("linkifyWikilinks", () => {
	it("converts vault path wikilinks into markdown citation links", () => {
		expect(
			linkifyWikilinks("See [[papers/vla/2504.16054/NOTES]] for notes."),
		).toBe("See [NOTES](papers/vla/2504.16054/NOTES.md) for notes.");
	});

	it("uses alias as the pill label", () => {
		expect(linkifyWikilinks("[[papers/vla/2504.16054/NOTES|π0.5 notes]]")).toBe(
			"[π0.5 notes](papers/vla/2504.16054/NOTES.md)",
		);
	});

	it("leaves embeds and alias-only wikilinks alone", () => {
		expect(linkifyWikilinks("![[papers/x/fig.png]] and [[CAMEL]]")).toBe(
			"![[papers/x/fig.png]] and [[CAMEL]]",
		);
	});

	it("skips wikilinks inside inline code and fences", () => {
		expect(linkifyWikilinks("Use `[[papers/x/NOTES]]` literally.")).toBe(
			"Use `[[papers/x/NOTES]]` literally.",
		);
		expect(
			linkifyWikilinks("```\n[[papers/x/NOTES]]\n```\n[[papers/y/NOTES]]"),
		).toBe("```\n[[papers/x/NOTES]]\n```\n[NOTES](papers/y/NOTES.md)");
	});

	it("does not require outer parentheses around citations", () => {
		const text =
			"Claim. [Section 2.3](papers/a/PAPER.md#section=2.3) and [[papers/a/NOTES]].";
		expect(linkifyWikilinks(text)).toBe(
			"Claim. [Section 2.3](papers/a/PAPER.md#section=2.3) and [NOTES](papers/a/NOTES.md).",
		);
	});
});
