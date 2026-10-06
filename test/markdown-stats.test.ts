import { describe, expect, it } from "vitest";
import { countChars, countWords } from "@/lib/markdown/stats";

describe("markdown stats", () => {
	it("counts English words and whitespace-separated tokens", () => {
		expect(countWords("Hello world")).toBe(2);
		expect(countWords("The quick brown fox jumps")).toBe(5);
	});

	it("counts each CJK character as one word", () => {
		expect(countWords("这是一个测试")).toBe(6);
		expect(countWords("你好世界")).toBe(4);
	});

	it("handles mixed Chinese/English text", () => {
		expect(countWords("Hello world 这是一个测试")).toBe(8);
		expect(countWords("AI 技术正在改变 world")).toBe(8);
	});

	it("ignores leading/trailing whitespace and empty input", () => {
		expect(countWords("")).toBe(0);
		expect(countWords("   ")).toBe(0);
		expect(countWords("  Hello  ")).toBe(1);
	});

	it("counts raw characters including whitespace", () => {
		expect(countChars("Hello")).toBe(5);
		expect(countChars("你好")).toBe(2);
		expect(countChars("Hello 你好")).toBe(8);
	});

	it("stays stateless across repeated CJK tokens and repeated calls", () => {
		// Regression: the CJK regex carried the `g` flag into `.test()`, whose
		// sticky lastIndex misclassified every other identical CJK token as a
		// latin word run ("汉 汉" counted 3 instead of 2).
		expect(countWords("汉 汉")).toBe(2);
		expect(countWords("汉字 汉字 汉字")).toBe(6);
		const sample = "汉字 word 汉字 word 汉字";
		const first = countWords(sample);
		expect(first).toBe(8);
		for (let i = 0; i < 5; i += 1) {
			expect(countWords(sample)).toBe(first);
		}
	});

	it("computes stats over a large document in one bounded pass (perf smoke)", () => {
		// 5000 paragraphs ≈ a large NOTES.md. One pass costs milliseconds — far
		// too much to repeat per keystroke, which is why the status bar debounces
		// (per-keystroke cost after the fix: schedule/clear one timer, ~0).
		const paragraph =
			"Lorem ipsum dolor sit amet 深度学习模型训练 consectetur adipiscing elit";
		const paragraphWords = countWords(paragraph);
		expect(paragraphWords).toBe(16); // 8 latin runs + 8 CJK chars
		const doc = Array.from({ length: 5000 }, () => paragraph).join("\n");
		const start = performance.now();
		const words = countWords(doc);
		const chars = countChars(doc);
		const elapsed = performance.now() - start;
		expect(words).toBe(paragraphWords * 5000);
		expect(chars).toBe(doc.length);
		console.info(
			`[markdown-stats perf] one pass over 5000 paragraphs (${doc.length} chars): ${elapsed.toFixed(2)}ms`,
		);
	});
});
