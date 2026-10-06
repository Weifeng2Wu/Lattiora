import { describe, expect, it } from "vitest";
import {
	LAYOUT_TRANSLATE_MAX_CHARS,
	splitLongLayoutTranslateSource,
} from "@/lib/pdf/layout/layout-translate-reliable";

describe("PDF layout translation reliability", () => {
	it("keeps oversized source instead of truncating it", () => {
		const sentences = Array.from(
			{ length: 80 },
			(_, index) =>
				`Sentence ${index} carries source text that must survive splitting.`,
		);
		const source = sentences.join(" ");
		const chunks = splitLongLayoutTranslateSource(source);

		expect(chunks.length).toBeGreaterThan(1);
		expect(
			chunks.every((chunk) => chunk.length <= LAYOUT_TRANSLATE_MAX_CHARS),
		).toBe(true);
		expect(chunks.join(" ")).toBe(source);
	});

	it("hard-splits unbroken text without losing characters", () => {
		const source = "x".repeat(LAYOUT_TRANSLATE_MAX_CHARS * 2 + 137);
		const chunks = splitLongLayoutTranslateSource(source);

		expect(chunks.map((chunk) => chunk.length)).toEqual([
			LAYOUT_TRANSLATE_MAX_CHARS,
			LAYOUT_TRANSLATE_MAX_CHARS,
			137,
		]);
		expect(chunks.join("")).toBe(source);
	});
});
