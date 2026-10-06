import { HorizontalRulePlugin } from "@platejs/basic-nodes/react";
import { BlockSelectionPlugin } from "@platejs/selection/react";
import { createSlateEditor, type TElement } from "platejs";
import { ParagraphPlugin } from "platejs/react";
import { describe, expect, it } from "vitest";
import {
	insertBreakAfterHorizontalRule,
	insertBreakAfterSelectedVoidBlocks,
} from "@/lib/markdown/block-selection";

function createHrEditor() {
	return createSlateEditor({
		plugins: [ParagraphPlugin, HorizontalRulePlugin, BlockSelectionPlugin],
		value: [
			{ id: "a", type: "p", children: [{ text: "Before" }] },
			{ id: "hr", type: "hr", children: [{ text: "" }] },
			{ id: "b", type: "p", children: [{ text: "After" }] },
		],
	});
}

describe("Markdown horizontal rule break", () => {
	it("inserts a paragraph below a caret-selected hr", () => {
		const editor = createHrEditor();
		editor.tf.select({
			anchor: { path: [1, 0], offset: 0 },
			focus: { path: [1, 0], offset: 0 },
		});

		expect(insertBreakAfterHorizontalRule(editor)).toBe(true);

		const types = editor.children.map((child) => (child as TElement).type);
		expect(types).toEqual(["p", "hr", "p", "p"]);
		expect(editor.selection).toMatchObject({
			anchor: { path: [2, 0], offset: 0 },
		});
	});

	it("is a no-op when the caret is not on an hr", () => {
		const editor = createHrEditor();
		editor.tf.select({
			anchor: { path: [0, 0], offset: 1 },
			focus: { path: [0, 0], offset: 1 },
		});

		expect(insertBreakAfterHorizontalRule(editor)).toBe(false);
		expect(editor.children).toHaveLength(3);
	});

	it("breaks out below a block-selected hr and clears the selection", () => {
		const editor = createHrEditor();
		editor.getApi(BlockSelectionPlugin).blockSelection.set(["hr"]);

		expect(insertBreakAfterSelectedVoidBlocks(editor)).toBe(true);

		const types = editor.children.map((child) => (child as TElement).type);
		expect(types).toEqual(["p", "hr", "p", "p"]);
		expect(editor.selection).toMatchObject({
			anchor: { path: [2, 0], offset: 0 },
		});
		expect(
			editor.getOption(BlockSelectionPlugin, "selectedIds")?.has("hr"),
		).toBe(false);
	});

	it("leaves block-selected text blocks to the selection plugin", () => {
		const editor = createHrEditor();
		editor.getApi(BlockSelectionPlugin).blockSelection.set(["a"]);

		expect(insertBreakAfterSelectedVoidBlocks(editor)).toBe(false);
		expect(editor.children).toHaveLength(3);
	});
});
