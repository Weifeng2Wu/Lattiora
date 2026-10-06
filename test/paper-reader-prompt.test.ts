import { describe, expect, it } from "vitest";

import {
	buildPaperReaderUserPrompt,
	paperReaderLanguageInstruction,
} from "@/lib/paper/reader";

describe("paper-reader user prompt language", () => {
	it("asks for Simplified Chinese when App locale is zh-CN", () => {
		expect(paperReaderLanguageInstruction("zh-CN")).toMatch(/Chinese/i);
		const prompt = buildPaperReaderUserPrompt("papers/1706.03762", "zh-CN");
		expect(prompt).toContain("Chinese (Simplified)");
		expect(prompt).toContain("Chinese section headings");
		expect(prompt).toContain("## 方法");
		expect(prompt).toContain("papers/1706.03762/NOTES.md");
	});

	it("asks for English when App locale is en", () => {
		expect(paperReaderLanguageInstruction("en")).toMatch(/English/i);
		const prompt = buildPaperReaderUserPrompt("papers/x", "en");
		expect(prompt).toContain("Write the NOTES.md body in English.");
		expect(prompt).toContain("Chinese section headings");
		expect(prompt).not.toContain("End with ## Sources");
		expect(prompt).toContain("do not add a trailing ## Sources block");
	});

	it("leaves skill activation syntax to the Host envelope", () => {
		const prompt = buildPaperReaderUserPrompt("papers/x", "en");
		expect(prompt).not.toMatch(
			/\$paper-reader|\/paper-reader|skill:paper-reader/,
		);
		expect(prompt).not.toMatch(
			/Activate and follow|do not wait for a separate/i,
		);
	});

	it("treats other zh* locales as Chinese", () => {
		expect(paperReaderLanguageInstruction("zh")).toMatch(/Chinese/i);
		expect(paperReaderLanguageInstruction("zh-TW")).toMatch(/Chinese/i);
	});
});
