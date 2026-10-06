import { MarkdownPlugin } from "@platejs/markdown";
import { createSlateEditor, createSlatePlugin, KEYS } from "platejs";
import { describe, expect, it } from "vitest";

import { MarkdownKit } from "@/components/editor/plugins/markdown-kit";
import {
	prepareMarkdownForDeserialize,
	preserveExtraBlankLines,
} from "@/lib/markdown/deserialize";

const ParagraphPlugin = createSlatePlugin({
	key: KEYS.p,
	node: { isElement: true },
});

const ZWSP = "\u200B";

describe("preserveExtraBlankLines", () => {
	it("rewrites extra blanks into Plate empty-paragraph placeholders", () => {
		expect(preserveExtraBlankLines("A\n\n\n\nB\n")).toBe(
			`A\n\n${ZWSP}\n\n${ZWSP}\n\nB\n`,
		);
		expect(preserveExtraBlankLines("A\n\nB\n")).toBe("A\n\nB\n");
	});

	it("does not touch blanks inside fenced code or math", () => {
		const code = "```\nA\n\n\n\nB\n```\n";
		expect(preserveExtraBlankLines(code)).toBe(code);
		const math = "$$\nA\n\n\n\nB\n$$\n";
		expect(preserveExtraBlankLines(math)).toBe(math);
	});

	it("leaves existing ZWSP placeholders alone", () => {
		const already = `A\n\n${ZWSP}\n\n${ZWSP}\n\nB\n`;
		expect(preserveExtraBlankLines(already)).toBe(already);
	});
});

describe("prepareMarkdownForDeserialize", () => {
	it("preserves extra blank paragraphs through Plate deserialize", () => {
		const editor = createSlateEditor({ plugins: MarkdownKit });
		const value = editor
			.getApi(MarkdownPlugin)
			.markdown.deserialize(prepareMarkdownForDeserialize("A\n\n\n\nB\n"));
		// remark drops the ZWSP glyph but keeps the empty paragraph nodes.
		const texts = value.map((node) => {
			const child = node.children?.[0] as { text?: string } | undefined;
			return child?.text ?? "";
		});
		expect(texts).toEqual(["A", "", "", "B"]);
		const roundTrip = createSlateEditor({
			plugins: MarkdownKit,
			value,
		})
			.getApi(MarkdownPlugin)
			.markdown.serialize();
		expect(roundTrip).toBe(`A\n\n${ZWSP}\n\n${ZWSP}\n\nB\n`);
	});

	it("escapes an unclosed block-math fence", () => {
		const source = "before\n$$\nbad _ {\n\nafter\n# heading";

		expect(prepareMarkdownForDeserialize(source)).toBe(
			"before\n\\$$\nbad _ {\n\nafter\n# heading",
		);
	});

	it("only repairs the unmatched fence", () => {
		const source = "$$\nvalid\n$$\n\n$$\nunclosed";

		expect(prepareMarkdownForDeserialize(source)).toBe(
			"$$\nvalid\n$$\n\n\\$$\nunclosed",
		);
	});

	it("leaves paired fences and inline math unchanged", () => {
		const source = "inline $x$ and\n$$\nE=mc^2\n$$";

		expect(prepareMarkdownForDeserialize(source)).toBe(source);
	});

	it("ignores math-looking lines inside fenced code", () => {
		const source = "```\n$$\nnot math\n```\n\n$$\nunclosed";

		expect(prepareMarkdownForDeserialize(source)).toBe(
			"```\n$$\nnot math\n```\n\n\\$$\nunclosed",
		);
	});

	it("ignores indented code that looks like a math fence", () => {
		const source = "    $$\n    not math";

		expect(prepareMarkdownForDeserialize(source)).toBe(source);
	});

	it("keeps Markdown after an invalid unclosed equation parseable", () => {
		const editor = createSlateEditor({
			plugins: [ParagraphPlugin, MarkdownPlugin],
			value: [{ type: "p", children: [{ text: "" }] }],
		});
		const source = "before\n$$\nbad _ {\n\nafter\n# heading";
		const value = editor
			.getApi(MarkdownPlugin)
			.markdown.deserialize(prepareMarkdownForDeserialize(source));

		expect(value).toMatchObject([
			{ type: "p", children: [{ text: "before\n$$\nbad _ {" }] },
			{ type: "p", children: [{ text: "after" }] },
			{ type: "h1", children: [{ text: "heading" }] },
		]);
	});
});
