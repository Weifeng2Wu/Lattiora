import { convertChildrenDeserialize, type MdRules } from "@platejs/markdown";
import {
	KEYS,
	NodeApi,
	type NodeEntry,
	nanoid,
	type SlateEditor,
	type TElement,
} from "platejs";

/**
 * 飞书式图片组:Markdown 中紧邻的图片行(同一 paragraph 内、软换行分隔)
 * 折叠为一个等高并排的顶层块,空行分隔即不同组。Slate 类型、mdast 类型与
 * Markdown 规则键三者统一为 IMAGE_GROUP_KEY。
 */
export const IMAGE_GROUP_KEY = "image_group";

/** 单组图片上限,对齐飞书。 */
export const MAX_IMAGE_GROUP_SIZE = 10;

type MdNode = {
	type: string;
	value?: string;
	children?: MdNode[];
};

type EditorLike = Pick<SlateEditor, "getType">;

/** 图片块的 Slate 类型;ImagePlugin 未注册的环境(单测)回退到内建 "img"。 */
export function imageBlockType(editor: EditorLike | undefined): string {
	return editor?.getType(KEYS.img) ?? KEYS.img;
}

export function isImageBlock(editor: EditorLike, node: TElement): boolean {
	return node.type === imageBlockType(editor);
}

/** 单图与图片组都是可并排(image-ish)的顶层块。 */
export function isImageishType(
	editor: EditorLike,
	type: string | undefined,
): boolean {
	if (type === IMAGE_GROUP_KEY) return true;
	return type != null && type === imageBlockType(editor);
}

function isBlankTextMdast(node: MdNode): boolean {
	return (
		node.type === "text" &&
		typeof node.value === "string" &&
		node.value.trim() === ""
	);
}

/** 纯图片紧邻行(children 全为 image / 空白 text 且 image ≥2)折叠为 image_group。 */
function imageGroupFromParagraph(node: MdNode): MdNode | null {
	if (node.type !== "paragraph" || !node.children?.length) return null;
	const images: MdNode[] = [];
	for (const child of node.children) {
		if (child.type === "image") {
			images.push(child);
			continue;
		}
		if (!isBlankTextMdast(child)) return null;
	}
	if (images.length < 2) return null;
	return { type: IMAGE_GROUP_KEY, children: images };
}

/**
 * 解析侧 remark 变换:只处理 root 直接子节点。blockquote / list 内的紧邻
 * 图片行保持原样 —— 组仅存在于顶层,与编辑器的成组交互范围一致。
 */
export function remarkImageGroup() {
	return (tree: MdNode) => {
		if (!tree.children) return;
		tree.children = tree.children.map(
			(child) => imageGroupFromParagraph(child) ?? child,
		);
	};
}

type TImageLikeElement = TElement & {
	url?: string;
	title?: string;
	caption?: { text?: string }[];
};

/** 与内建 img 规则的 serialize 保持同一 alt / title / url 产出。 */
function imageToMdast(node: TImageLikeElement) {
	return {
		alt: node.caption?.length
			? node.caption.map((leaf) => leaf.text ?? "").join("")
			: undefined,
		title: typeof node.title === "string" ? node.title : undefined,
		type: "image",
		url: node.url,
	};
}

export const imageGroupRules = {
	[IMAGE_GROUP_KEY]: {
		deserialize: (node, deco, options) => ({
			type: IMAGE_GROUP_KEY,
			// 每个 image mdast 子节点走内建 img 规则,保留 url / alt(caption)/ title。
			children: convertChildrenDeserialize(node.children ?? [], deco, options),
		}),
		serialize: (node, options) => {
			const imgType = imageBlockType(options.editor);
			const children: unknown[] = [];
			// 单个 paragraph 内以 text("\n") 相连,remark-stringify 原样输出紧邻行。
			for (const child of node.children) {
				if (child.type !== imgType) continue;
				if (children.length > 0) children.push({ type: "text", value: "\n" });
				children.push(imageToMdast(child as TImageLikeElement));
			}
			return { type: "paragraph", children };
		},
	},
} satisfies MdRules;

/**
 * 图片组的结构收敛,全部规则幂等、每条触发后 return 让 Slate 重新调度:
 *
 * N1 空组删除(合并后的空壳)N2 组内混入非图片子节点提升出组(组后)
 * N3 单张组解散 N4 超 MAX 拆分(溢出部分原地成新组)
 * N5 顶层相邻收敛(只从右节点视角处理):相邻单图成组、组吸收相邻图、
 * 相邻组合并 —— 超 MAX 的相邻保持独立(serialize 空行分隔,reparse 稳定)。
 */
export function normalizeImageGroups(
	editor: SlateEditor,
	normalizeNode: (entry: NodeEntry) => void,
): (entry: NodeEntry) => void {
	// 成组是拖拽落位的自动收尾,不产生独立 undo 步。
	const repair = (fn: () => void) => {
		editor.tf.withoutNormalizing(() => {
			editor.tf.withoutSaving(fn);
		});
	};

	// wrap_node 不会触发 NodeIdPlugin 补 id(withNodeId 只拦 insert/split),
	// 组级拖拽、落线与块选都依赖 element.id,建组时显式带上。
	const newGroup = () => ({
		id: nanoid(10),
		type: IMAGE_GROUP_KEY,
		children: [{ text: "" }],
	});

	return ([node, path]) => {
		if (path.length !== 1) return normalizeNode([node, path]);
		const element = node as TElement;
		const imgType = imageBlockType(editor);

		if (element.type === IMAGE_GROUP_KEY) {
			const children = element.children as TElement[];
			if (children.length === 0) {
				repair(() => editor.tf.removeNodes({ at: path }));
				return;
			}
			const foreign = children.findIndex((child) => child.type !== imgType);
			if (foreign >= 0) {
				repair(() => editor.tf.liftNodes({ at: [...path, foreign] }));
				return;
			}
			if (children.length === 1) {
				repair(() => editor.tf.unwrapNodes({ at: path }));
				return;
			}
			if (children.length > MAX_IMAGE_GROUP_SIZE) {
				const splitAt = MAX_IMAGE_GROUP_SIZE;
				// 溢出首张原地包成新组,其余逐个追加:恒取新组后的第一个,
				// 源索引不漂移,目标索引恒为新组末尾(to 越界会被 Slate 收敛错位)。
				repair(() => {
					editor.tf.wrapNodes(newGroup(), {
						at: [...path, splitAt],
					});
					const overflow = children.length - splitAt - 1;
					for (let i = 0; i < overflow; i++) {
						editor.tf.moveNodes({
							at: [...path, splitAt + 1],
							to: [...path, splitAt, i + 1],
						});
					}
				});
				return;
			}
		}

		if (path[0] === 0) return normalizeNode([node, path]);
		const prev = NodeApi.get(editor, [path[0] - 1]) as TElement | undefined;
		if (!prev) return normalizeNode([node, path]);

		const prevChildren = prev.children as TElement[];
		const nodeChildren = element.children as TElement[];

		if (prev.type === imgType && element.type === imgType) {
			repair(() => {
				editor.tf.wrapNodes(newGroup(), { at: [path[0] - 1] });
				editor.tf.moveNodes({ at: path, to: [path[0] - 1, 1] });
			});
			return;
		}
		if (
			prev.type === IMAGE_GROUP_KEY &&
			element.type === imgType &&
			prevChildren.length < MAX_IMAGE_GROUP_SIZE
		) {
			repair(() => {
				editor.tf.moveNodes({
					at: path,
					to: [path[0] - 1, prevChildren.length],
				});
			});
			return;
		}
		if (
			prev.type === imgType &&
			element.type === IMAGE_GROUP_KEY &&
			nodeChildren.length < MAX_IMAGE_GROUP_SIZE
		) {
			repair(() => {
				editor.tf.moveNodes({ at: [path[0] - 1], to: [...path, 0] });
			});
			return;
		}
		if (
			prev.type === IMAGE_GROUP_KEY &&
			element.type === IMAGE_GROUP_KEY &&
			prevChildren.length + nodeChildren.length <= MAX_IMAGE_GROUP_SIZE
		) {
			// 右组子节点逐个追加到左组末尾(恒取右组第一个),空壳由 N1 清除。
			repair(() => {
				for (let i = 0; i < nodeChildren.length; i++) {
					editor.tf.moveNodes({
						at: [...path, 0],
						to: [path[0] - 1, prevChildren.length + i],
					});
				}
			});
			return;
		}

		return normalizeNode([node, path]);
	};
}
