"use client";

import { createPlatePlugin } from "platejs/react";
import { ImageGroupElement } from "@/components/editor/nodes/block/image-group-node";
import {
	IMAGE_GROUP_KEY,
	normalizeImageGroups,
} from "@/lib/markdown/image-group";

/**
 * 飞书式图片组:同一顶层块内的图片单行并排、自动等高。组的形成、解散、
 * 合并与拆分全部收敛在 normalizeNode(见 normalizeImageGroups),拖拽等
 * 交互只负责把图片 moveNodes 落到相邻位置。
 */
export const ImageGroupPlugin = createPlatePlugin({
	key: IMAGE_GROUP_KEY,
	node: { isElement: true, isContainer: true },
})
	.withComponent(ImageGroupElement)
	.overrideEditor(({ editor, tf: { normalizeNode } }) => ({
		transforms: {
			normalizeNode: normalizeImageGroups(editor, normalizeNode),
		},
	}));
