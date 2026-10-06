import { MarkdownPlugin } from "@platejs/markdown";
import { createSlateEditor, createSlatePlugin, KEYS } from "platejs";
import remarkDirective from "remark-directive";
import { describe, expect, it } from "vitest";
import {
	ColumnGroupPlugin,
	ColumnPlugin,
} from "@/components/editor/plugins/column-group-plugin";
import { MarkdownKit } from "@/components/editor/plugins/markdown-kit";
import {
	addColumnToGroup,
	COLUMN_GROUP_KEY,
	COLUMN_KEY,
	columnsRules,
	convertImageGroupToColumnGroup,
	createColumnGroupFromBlocks,
	MAX_COLUMNS,
	remarkColumns,
} from "@/lib/markdown/columns";
import { IMAGE_GROUP_KEY } from "@/lib/markdown/image-group";

const TestParagraphPlugin = createSlatePlugin({
	key: KEYS.p,
	node: { isElement: true },
});

const TestImagePlugin = createSlatePlugin({
	key: KEYS.img,
	node: { isElement: true, isVoid: true },
});

const TestColumnGroupPlugin = createSlatePlugin({
	key: COLUMN_GROUP_KEY,
	node: { isElement: true },
});

const TestColumnPlugin = createSlatePlugin({
	key: COLUMN_KEY,
	node: { isElement: true },
});

const TestMarkdownPlugin = MarkdownPlugin.configure({
	options: {
		remarkPlugins: [remarkDirective, remarkColumns],
		rules: { ...columnsRules },
	},
});

function createColumnEditor(markdown: string) {
	return createSlateEditor({
		plugins: [
			TestParagraphPlugin,
			TestImagePlugin,
			TestColumnGroupPlugin,
			TestColumnPlugin,
			TestMarkdownPlugin,
		],
		value: (editor) =>
			editor.getApi(MarkdownPlugin).markdown.deserialize(markdown),
	});
}

function createNormalizeEditor(value: unknown[]) {
	const editor = createSlateEditor({
		plugins: [
			TestParagraphPlugin,
			TestImagePlugin,
			ColumnGroupPlugin,
			ColumnPlugin,
		],
		value: value as never,
	});
	editor.tf.normalize({ force: true });
	return editor;
}

function imageEl(url: string) {
	return { type: "img", url, children: [{ text: "" }] };
}

function pEl(text: string) {
	return { type: "p", children: [{ text }] };
}

function colOf(children: unknown[]) {
	return { type: COLUMN_KEY, children };
}

describe("column Markdown model", () => {
	it("deserializes columns/col directives into column_group/column", () => {
		const editor = createColumnEditor(
			"::::columns\n:::col\n\n![](a.png)\n\n:::\n:::col\n\nSome text\n\n:::\n::::",
		);

		expect(editor.children).toMatchObject([
			{
				type: COLUMN_GROUP_KEY,
				children: [
					{
						type: COLUMN_KEY,
						children: [{ type: "img", url: "a.png" }],
					},
					{
						type: COLUMN_KEY,
						children: [{ type: "p", children: [{ text: "Some text" }] }],
					},
				],
			},
		]);
	});

	it("serializes a column group back to columns/col directives", () => {
		const editor = createColumnEditor(
			"::::columns\n:::col\n\n![](a.png)\n\n:::\n:::col\n\nSome text\n\n:::\n::::",
		);
		const serialized = editor.getApi(MarkdownPlugin).markdown.serialize();
		expect(serialized).toContain("columns");
		expect(serialized).toContain("col");
		expect(serialized).toContain("![](a.png)");
		expect(serialized).toContain("Some text");
	});

	it("uses the production Markdown kit for columns", () => {
		const editor = createSlateEditor({
			plugins: [
				TestParagraphPlugin,
				TestImagePlugin,
				TestColumnGroupPlugin,
				TestColumnPlugin,
				...MarkdownKit,
			],
			value: (currentEditor) =>
				currentEditor
					.getApi(MarkdownPlugin)
					.markdown.deserialize(
						"::::columns\n:::col\n\n![](a.png)\n\n:::\n::::",
					),
		});

		expect(editor.children).toMatchObject([
			{
				type: COLUMN_GROUP_KEY,
				children: [{ type: COLUMN_KEY, children: [{ url: "a.png" }] }],
			},
		]);
	});
});

describe("column normalize", () => {
	it("removes an empty column group", () => {
		const editor = createNormalizeEditor([
			{ type: COLUMN_GROUP_KEY, children: [] },
			pEl("after"),
		]);
		expect(editor.children).toMatchObject([
			{ type: "p", children: [{ text: "after" }] },
		]);
	});

	it("unwraps a single-column group", () => {
		const editor = createNormalizeEditor([
			{
				type: COLUMN_GROUP_KEY,
				children: [colOf([imageEl("a.png")])],
			},
		]);
		expect(editor.children).toMatchObject([{ type: "img", url: "a.png" }]);
	});

	it("removes empty columns and keeps the rest", () => {
		const editor = createNormalizeEditor([
			{
				type: COLUMN_GROUP_KEY,
				children: [
					colOf([imageEl("a.png")]),
					{ type: COLUMN_KEY, children: [] },
					colOf([imageEl("b.png")]),
				],
			},
		]);
		expect(editor.children).toHaveLength(1);
		const group = editor.children[0] as {
			type?: string;
			children?: { children?: { url?: string }[] }[];
		};
		expect(group.type).toBe(COLUMN_GROUP_KEY);
		expect(group.children?.map((c) => c.children?.[0]?.url)).toEqual([
			"a.png",
			"b.png",
		]);
	});

	it("lifts columns that exceed the max count", () => {
		const columns = Array.from({ length: MAX_COLUMNS + 2 }, (_, i) =>
			colOf([imageEl(`${i}.png`)]),
		);
		const editor = createNormalizeEditor([
			{ type: COLUMN_GROUP_KEY, children: columns },
		]);
		const group = editor.children[0] as { type?: string; children?: unknown[] };
		expect(group.type).toBe(COLUMN_GROUP_KEY);
		expect(group.children).toHaveLength(MAX_COLUMNS);
		expect(editor.children).toHaveLength(3);
	});

	it("gives created groups and columns an id", () => {
		const editor = createNormalizeEditor([imageEl("a.png"), imageEl("b.png")]);
		createColumnGroupFromBlocks(editor, [0], [1]);
		editor.tf.normalize({ force: true });

		const group = editor.children[0] as { id?: string; type?: string };
		expect(group.type).toBe(COLUMN_GROUP_KEY);
		expect(typeof group.id).toBe("string");
		expect(group.id?.length).toBeGreaterThan(0);

		const cols = (group as { children?: { id?: string }[] }).children ?? [];
		for (const col of cols) {
			expect(typeof col.id).toBe("string");
			expect(col.id?.length).toBeGreaterThan(0);
		}
	});
});

describe("column transforms", () => {
	it("wraps two top-level blocks into a two-column group", () => {
		const editor = createNormalizeEditor([imageEl("a.png"), imageEl("b.png")]);
		createColumnGroupFromBlocks(editor, [0], [1]);
		editor.tf.normalize({ force: true });

		expect(editor.children).toHaveLength(1);
		const group = editor.children[0] as {
			type?: string;
			children?: { type?: string; children?: { url?: string }[] }[];
		};
		expect(group.type).toBe(COLUMN_GROUP_KEY);
		expect(group.children?.map((c) => c.children?.[0]?.url)).toEqual([
			"a.png",
			"b.png",
		]);
	});

	it("keeps target on the left and source on the right when source was originally before target", () => {
		const editor = createNormalizeEditor([
			imageEl("source.png"),
			imageEl("target.png"),
		]);
		createColumnGroupFromBlocks(editor, [1], [0]);
		editor.tf.normalize({ force: true });

		const group = editor.children[0] as {
			children?: { children?: { url?: string }[] }[];
		};
		expect(group.children?.map((c) => c.children?.[0]?.url)).toEqual([
			"target.png",
			"source.png",
		]);
	});

	it("adds a block as a new column to an existing group", () => {
		const editor = createNormalizeEditor([
			imageEl("a.png"),
			{
				type: COLUMN_GROUP_KEY,
				children: [colOf([imageEl("b.png")]), colOf([imageEl("c.png")])],
			},
		]);
		addColumnToGroup(editor, [1], [0]);
		editor.tf.normalize({ force: true });

		expect(editor.children).toHaveLength(1);
		const group = editor.children[0] as {
			children?: { children?: { url?: string }[] }[];
		};
		expect(group.children?.map((c) => c.children?.[0]?.url)).toEqual([
			"b.png",
			"c.png",
			"a.png",
		]);
	});

	it("does not add a column beyond the max count", () => {
		const columns = Array.from({ length: MAX_COLUMNS }, (_, i) =>
			colOf([imageEl(`${i}.png`)]),
		);
		const editor = createNormalizeEditor([
			imageEl("extra.png"),
			{ type: COLUMN_GROUP_KEY, children: columns },
		]);
		addColumnToGroup(editor, [1], [0]);
		editor.tf.normalize({ force: true });

		const group = editor.children.find(
			(n) => (n as { type?: string }).type === COLUMN_GROUP_KEY,
		) as { children?: unknown[] } | undefined;
		expect(group?.children).toHaveLength(MAX_COLUMNS);
	});

	it("converts an image group into a column group with each image as a column", () => {
		const editor = createNormalizeEditor([
			{
				type: IMAGE_GROUP_KEY,
				children: [imageEl("a.png"), imageEl("b.png"), imageEl("c.png")],
			},
		]);
		convertImageGroupToColumnGroup(editor, [0]);
		editor.tf.normalize({ force: true });

		const group = editor.children[0] as {
			type?: string;
			children?: { children?: { url?: string }[] }[];
		};
		expect(group.type).toBe(COLUMN_GROUP_KEY);
		expect(group.children?.map((c) => c.children?.[0]?.url)).toEqual([
			"a.png",
			"b.png",
			"c.png",
		]);
	});

	it("appends an external image when converting an image group to columns", () => {
		const editor = createNormalizeEditor([
			{
				type: IMAGE_GROUP_KEY,
				children: [imageEl("a.png"), imageEl("b.png")],
			},
			imageEl("c.png"),
		]);
		convertImageGroupToColumnGroup(editor, [0], [1]);
		editor.tf.normalize({ force: true });

		const group = editor.children[0] as {
			children?: { children?: { url?: string }[] }[];
		};
		expect(group.children?.map((c) => c.children?.[0]?.url)).toEqual([
			"a.png",
			"b.png",
			"c.png",
		]);
	});
});
