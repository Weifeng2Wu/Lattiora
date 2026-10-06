import { describe, expect, it } from "vitest";

import {
	findWikiBlockIdRange,
	findWikiHeadingIndex,
	hasWikiBlockAnchor,
} from "@/lib/wiki/navigation";

describe("wikilink navigation anchors", () => {
	it("uses the full heading path when leaf headings repeat", () => {
		const headings = [
			{ level: 1, text: "Root A" },
			{ level: 2, text: "Child" },
			{ level: 1, text: "Root B" },
			{ level: 2, text: "Child" },
		];
		expect(findWikiHeadingIndex(headings, ["Root B", "Child"])).toBe(3);
		expect(findWikiHeadingIndex(headings, ["Child"])).toBe(-1);
		expect(findWikiHeadingIndex(headings, ["Missing"])).toBe(-1);
	});

	it("uses a unique heading-path suffix without imposing a depth limit", () => {
		const headings = [
			{ level: 1, text: "Week" },
			{ level: 2, text: "07-28 周二" },
			{ level: 3, text: "复盘分析" },
			{ level: 4, text: "paper 阅读" },
			{ level: 1, text: "Other" },
			{ level: 2, text: "复盘分析" },
			{ level: 3, text: "notes 整理" },
		];

		expect(findWikiHeadingIndex(headings, ["复盘分析", "paper 阅读"])).toBe(3);
		expect(
			findWikiHeadingIndex(headings, [
				"Week",
				"07-28 周二",
				"复盘分析",
				"paper 阅读",
			]),
		).toBe(3);
	});

	it("rejects an ambiguous multi-segment heading-path suffix", () => {
		const headings = [
			{ level: 1, text: "Week A" },
			{ level: 2, text: "复盘分析" },
			{ level: 3, text: "paper 阅读" },
			{ level: 1, text: "Week B" },
			{ level: 2, text: "复盘分析" },
			{ level: 3, text: "paper 阅读" },
		];

		expect(findWikiHeadingIndex(headings, ["复盘分析", "paper 阅读"])).toBe(-1);
	});

	it("matches the canonical path when heading levels are skipped", () => {
		const headings = [
			{ level: 1, text: "Root" },
			{ level: 3, text: "Skipped level child" },
			{ level: 4, text: "Leaf" },
		];

		expect(
			findWikiHeadingIndex(headings, ["Skipped level child", "Leaf"]),
		).toBe(2);
		expect(
			findWikiHeadingIndex(headings, ["Root", "Skipped level child", "Leaf"]),
		).toBe(2);
	});

	it("recognizes block IDs only at the end of their rendered block", () => {
		expect(hasWikiBlockAnchor("Summary text ^summary", "summary")).toBe(true);
		expect(hasWikiBlockAnchor("可精确定位到本段。 ^验收块", "验收块")).toBe(
			true,
		);
		expect(hasWikiBlockAnchor("^summary followed by prose", "summary")).toBe(
			false,
		);
		expect(hasWikiBlockAnchor("not-a-block^summary", "summary")).toBe(false);
	});

	it("locates valid trailing block IDs for Live Preview styling", () => {
		expect(findWikiBlockIdRange("可精确定位到本段。 ^验收块")).toEqual({
			start: 10,
			end: 14,
		});
		expect(findWikiBlockIdRange("Text ^asb  ")).toEqual({
			start: 5,
			end: 9,
		});
		expect(findWikiBlockIdRange("Text ^bad id")).toBeNull();
		expect(findWikiBlockIdRange("`code ^asb`")).toBeNull();
	});
});
