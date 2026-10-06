import {
	convertChildrenDeserialize,
	convertNodesSerialize,
	type MdRules,
} from "@platejs/markdown";
import type { Descendant } from "platejs";
import {
	NodeApi,
	type NodeEntry,
	nanoid,
	type SlateEditor,
	type TElement,
} from "platejs";
import { imageBlockType } from "@/lib/markdown/image-group";

/**
 * 文档分栏容器：column_group 包含若干 column，每列是一个独立的内容容器。
 * Markdown 用 remark-directive 的容器指令持久化：
 *
 * ::::columns
 * :::col
 * 内容块
 * :::
 * :::col
 * 内容块
 * :::
 * ::::
 */
export const COLUMN_GROUP_KEY = "column_group";
export const COLUMN_KEY = "column";

/** 同一分栏组最多 10 列，对齐飞书文档上限。 */
export const MAX_COLUMNS = 10;

type MdNode = {
	type: string;
	name?: string;
	attributes?: Record<string, unknown>;
	value?: string;
	children?: MdNode[];
};

export function isColumnGroup(node: TElement): boolean {
	return node.type === COLUMN_GROUP_KEY;
}

export function isColumn(node: TElement): boolean {
	return node.type === COLUMN_KEY;
}

function isContainerDirective(node: MdNode, name: string): boolean {
	return node.type === "containerDirective" && node.name === name;
}

function columnGroupFromDirective(node: MdNode): MdNode {
	const columns: MdNode[] = [];
	for (const child of node.children ?? []) {
		if (isContainerDirective(child, "col")) {
			columns.push({ type: COLUMN_KEY, children: child.children ?? [] });
		}
	}
	return { type: COLUMN_GROUP_KEY, children: columns };
}

function transformTree(node: MdNode): void {
	if (!node.children) return;
	node.children = node.children.flatMap((child) => {
		if (isContainerDirective(child, "columns")) {
			return [columnGroupFromDirective(child)];
		}
		transformTree(child);
		return [child];
	});
}

/**
 * Remark 阶段把 `columns` / `col` 容器指令映射为我们的 mdast 类型，
 * 这样 Plate 的 Markdown rules 才能按 key 反序列化。
 */
export function remarkColumns() {
	return (tree: MdNode) => {
		transformTree(tree);
	};
}

interface TColumnElement extends TElement {
	type: "column";
	width: string;
	id?: string;
}

interface TColumnGroupElement extends TElement {
	type: "column_group";
	children: TColumnElement[];
	layout?: number[];
	id?: string;
}

/** 新建分栏容器，显式带 id（wrapNodes 不会经过 NodeIdPlugin）。 */
function newColumnGroup(children: TColumnElement[] = []): TColumnGroupElement {
	return {
		id: nanoid(10),
		type: COLUMN_GROUP_KEY,
		children,
	};
}

function newColumn(
	children: Descendant[] = [],
	width = "auto",
): TColumnElement {
	return {
		id: nanoid(10),
		type: COLUMN_KEY,
		width,
		children,
	};
}

export const columnsRules = {
	[COLUMN_GROUP_KEY]: {
		deserialize: (node, deco, options): TColumnGroupElement => ({
			type: COLUMN_GROUP_KEY,
			children: convertChildrenDeserialize(
				node.children ?? [],
				deco,
				options,
			) as TColumnElement[],
		}),
		serialize: (node, options) => ({
			type: "containerDirective",
			name: "columns",
			attributes: {},
			children: convertNodesSerialize(node.children, options),
		}),
	},
	[COLUMN_KEY]: {
		deserialize: (node, deco, options): TColumnElement => ({
			type: COLUMN_KEY,
			width: "auto",
			children: convertChildrenDeserialize(node.children ?? [], deco, options),
		}),
		serialize: (node, options) => ({
			type: "containerDirective",
			name: "col",
			attributes: {},
			children: convertNodesSerialize(node.children, options),
		}),
	},
} satisfies MdRules;

/**
 * 分栏结构收敛：空组删除、单列解散、空列删除、列上限截断。
 * 所有规则幂等，每次触发后 return 让 Slate 重新调度。
 */
export function normalizeColumns(
	editor: SlateEditor,
	normalizeNode: (entry: NodeEntry) => void,
): (entry: NodeEntry) => void {
	const repair = (fn: () => void) => {
		editor.tf.withoutNormalizing(() => {
			editor.tf.withoutSaving(fn);
		});
	};

	return ([node, path]) => {
		const element = node as TElement;

		// 只处理顶层 column_group 以及其直接子 column。
		if (
			path.length !== 1 &&
			!(path.length === 2 && element.type === COLUMN_KEY)
		) {
			return normalizeNode([node, path]);
		}

		if (element.type === COLUMN_GROUP_KEY) {
			const children = element.children as TElement[];

			if (children.length === 0) {
				repair(() => editor.tf.removeNodes({ at: path }));
				return;
			}

			if (children.length === 1) {
				// 先解散 group，column 会落到顶层，下一轮 normalize 再解 column。
				repair(() => editor.tf.unwrapNodes({ at: path }));
				return;
			}

			if (children.length > MAX_COLUMNS) {
				// 溢出列原地提升为顶层块（保持顺序）。
				repair(() => {
					for (let i = children.length - 1; i >= MAX_COLUMNS; i--) {
						editor.tf.liftNodes({ at: [...path, i] });
					}
				});
				return;
			}
		}

		if (element.type === COLUMN_KEY) {
			const children = element.children as TElement[];

			if (path.length === 2) {
				// 组内空列直接删除。
				if (children.length === 0) {
					repair(() => editor.tf.removeNodes({ at: path }));
					return;
				}
				// 组内非空列保持不动。
				return normalizeNode([node, path]);
			}

			// 落到顶层的 column（group 解散后）直接解包。
			if (path.length === 1) {
				repair(() => editor.tf.unwrapNodes({ at: path }));
				return;
			}
		}

		return normalizeNode([node, path]);
	};
}

/**
 * 把目标块和源块包成一个新的两分栏组。
 * 目标块成为左列，源块成为右列，插入到两者原位置中较早的地方。
 */
export function createColumnGroupFromBlocks(
	editor: SlateEditor,
	targetPath: number[],
	sourcePath: number[],
): void {
	if (targetPath.length !== 1) return;
	const [targetIndex] = targetPath;
	const targetNode = NodeApi.get(editor, targetPath) as TElement;
	const sourceNode = NodeApi.get(editor, sourcePath) as TElement;

	editor.tf.withoutNormalizing(() => {
		editor.tf.withoutSaving(() => {
			// 先移除源块。
			editor.tf.removeNodes({ at: sourcePath });

			// 若源块是顶层块且位于目标之前，目标顶层索引会前移一位。
			let adjustedTargetIndex = targetIndex;
			if (sourcePath.length === 1 && sourcePath[0] < targetIndex) {
				adjustedTargetIndex -= 1;
			}

			// 移除目标块。
			editor.tf.removeNodes({ at: [adjustedTargetIndex] });

			// 插入新的分栏组。
			const insertIndex =
				sourcePath.length === 1
					? Math.min(targetIndex, sourcePath[0])
					: targetIndex;

			editor.tf.insertNodes(
				newColumnGroup([newColumn([targetNode]), newColumn([sourceNode])]),
				{ at: [insertIndex] },
			);
		});
	});
}

/**
 * 把源块作为新列追加到已有分栏组末尾。
 */
export function addColumnToGroup(
	editor: SlateEditor,
	groupPath: number[],
	sourcePath: number[],
): void {
	const [groupIndex] = groupPath;
	const sourceNode = NodeApi.get(editor, sourcePath) as TElement;

	editor.tf.withoutNormalizing(() => {
		editor.tf.withoutSaving(() => {
			editor.tf.removeNodes({ at: sourcePath });

			// 只有移除顶层块才会影响后续顶层索引。
			let adjustedGroupIndex = groupIndex;
			if (sourcePath.length === 1 && sourcePath[0] < groupIndex) {
				adjustedGroupIndex -= 1;
			}

			const group = NodeApi.get(editor, [adjustedGroupIndex]) as TElement;
			const columnCount = (group.children as TElement[]).length;
			if (columnCount >= MAX_COLUMNS) return;

			editor.tf.insertNodes(newColumn([sourceNode]), {
				at: [adjustedGroupIndex, columnCount],
			});
		});
	});
}

/**
 * 把图片组（image_group）拆分为分栏组：组内每张图各占一列。
 * 如果源块来自组外，则把它作为最后一列追加；如果源块是组内成员，
 * 拆分后它仍位于原顺序对应的列中。
 */
export function convertImageGroupToColumnGroup(
	editor: SlateEditor,
	groupPath: number[],
	sourcePath?: number[],
): void {
	const [groupIndex] = groupPath;
	const group = NodeApi.get(editor, groupPath) as TElement;
	const imgType = imageBlockType(editor);
	const images = (group.children as TElement[]).filter(
		(child) => child.type === imgType,
	);
	if (images.length === 0) return;

	editor.tf.withoutNormalizing(() => {
		editor.tf.withoutSaving(() => {
			// 源块来自组外时，先移除并作为新列追加。
			let appended: TElement | undefined;
			let finalGroupIndex = groupIndex;
			if (
				sourcePath &&
				!(sourcePath.length > 1 && sourcePath[0] === groupIndex)
			) {
				appended = NodeApi.get(editor, sourcePath) as TElement;
				editor.tf.removeNodes({ at: sourcePath });
				if (sourcePath.length === 1 && sourcePath[0] < groupIndex) {
					finalGroupIndex -= 1;
				}
			}

			editor.tf.removeNodes({ at: [finalGroupIndex] });

			const columns = images.map((img) => newColumn([img]));
			if (appended) {
				columns.push(newColumn([appended]));
			}

			editor.tf.insertNodes(newColumnGroup(columns), {
				at: [finalGroupIndex],
			});
		});
	});
}
