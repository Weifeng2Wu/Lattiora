"use client";

import { createPlatePlugin } from "platejs/react";
import {
	ColumnElement,
	ColumnGroupElement,
} from "@/components/editor/nodes/block/column-group-node";
import {
	COLUMN_GROUP_KEY,
	COLUMN_KEY,
	normalizeColumns,
} from "@/lib/markdown/columns";

/**
 * 文档分栏：column_group 为顶层容器，column 为等宽列。
 * 结构收敛统一交给 normalizeColumns。
 */
export const ColumnGroupPlugin = createPlatePlugin({
	key: COLUMN_GROUP_KEY,
	node: { isElement: true, isContainer: true },
})
	.withComponent(ColumnGroupElement)
	.overrideEditor(({ editor, tf: { normalizeNode } }) => ({
		transforms: {
			normalizeNode: normalizeColumns(editor, normalizeNode),
		},
	}));

export const ColumnPlugin = createPlatePlugin({
	key: COLUMN_KEY,
	node: { isElement: true, isContainer: true },
}).withComponent(ColumnElement);
