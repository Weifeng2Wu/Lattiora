import katex from "katex";
import { describe, expect, it } from "vitest";
import { hasTitleMath, parseTitleMath } from "@/lib/paper/title-math";

function renderSegments(text: string): string {
	return parseTitleMath(text)
		.map((segment) => {
			if (segment.kind === "text") return segment.value;
			return katex.renderToString(segment.value, {
				displayMode: false,
				throwOnError: true,
			});
		})
		.join("");
}

describe("hasTitleMath", () => {
	it("detects dollar and paren/bracket delimiters", () => {
		expect(hasTitleMath("plain title")).toBe(false);
		expect(hasTitleMath(String.raw`Learning $\pi$ policies`)).toBe(true);
		expect(hasTitleMath(String.raw`Cost is \$5 only`)).toBe(false);
		expect(hasTitleMath(String.raw`Via \(\alpha\)-mixing`)).toBe(true);
		expect(hasTitleMath(String.raw`Score \[x\]`)).toBe(true);
	});
});

describe("parseTitleMath", () => {
	it("keeps plain titles as a single text segment", () => {
		expect(parseTitleMath("Attention Is All You Need")).toEqual([
			{ kind: "text", value: "Attention Is All You Need" },
		]);
	});

	it("splits inline $...$ math", () => {
		expect(parseTitleMath(String.raw`Learning $\pi$ policies`)).toEqual([
			{ kind: "text", value: "Learning " },
			{ kind: "math", value: String.raw`\pi` },
			{ kind: "text", value: " policies" },
		]);
	});

	it("supports $$...$$ and \\(...\\) / \\[...\\]", () => {
		expect(parseTitleMath(String.raw`A $$x^2$$ B`)).toEqual([
			{ kind: "text", value: "A " },
			{ kind: "math", value: "x^2" },
			{ kind: "text", value: " B" },
		]);
		expect(parseTitleMath(String.raw`A \(\alpha\) B`)).toEqual([
			{ kind: "text", value: "A " },
			{ kind: "math", value: String.raw`\alpha` },
			{ kind: "text", value: " B" },
		]);
		expect(parseTitleMath(String.raw`A \[\beta\] B`)).toEqual([
			{ kind: "text", value: "A " },
			{ kind: "math", value: String.raw`\beta` },
			{ kind: "text", value: " B" },
		]);
	});

	it("leaves unclosed $ as plain text", () => {
		expect(parseTitleMath("half $open")).toEqual([
			{ kind: "text", value: "half $open" },
		]);
	});

	it("ignores escaped currency dollars", () => {
		expect(parseTitleMath(String.raw`Only \$5 today`)).toEqual([
			{ kind: "text", value: String.raw`Only \$5 today` },
		]);
	});

	it("renders common title math with KaTeX", () => {
		expect(() =>
			renderSegments(String.raw`Bandits with $\pi$-greedy and $\mathrm{H}_2$O`),
		).not.toThrow();
		const html = renderSegments(String.raw`Hello $\pi$`);
		expect(html).toContain("katex");
		expect(html).toContain("Hello ");
	});
});
