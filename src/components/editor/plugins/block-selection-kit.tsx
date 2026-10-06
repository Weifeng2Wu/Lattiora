"use client";

import { BlockSelectionPlugin } from "@platejs/selection/react";
import { getPluginTypes, KEYS } from "platejs";
import type { PlateElementProps } from "platejs/react";

import {
	BlockSelection,
	hasSelectableClass,
} from "@/components/editor/nodes/block/block-selection";

/**
 * Live-editor only. Export / embed surfaces keep MarkdownEditorKit so they
 * never grow drag handles or a selection marquee.
 */
export const BlockSelectionKit = [
	BlockSelectionPlugin.configure(({ editor }) => ({
		options: {
			enableContextMenu: false,
			isSelectable: (element, path) => {
				if (path.length !== 1) return false;
				return !getPluginTypes(editor, [
					KEYS.column,
					KEYS.codeLine,
					KEYS.td,
					KEYS.tr,
				]).includes(element.type);
			},
			areaOptions: {
				// Attribute selector: uid may start with a digit, which `#id` cannot.
				boundaries: `[id="${editor.meta.uid}"]`,
				container: `[id="${editor.meta.uid}"]`,
				selectables: `[id="${editor.meta.uid}"] .slate-selectable`,
				behaviour: {
					startThreshold: 4,
					scrolling: { speedDivider: 0.8 },
				},
			},
		},
		render: {
			belowRootNodes: (props) => {
				if (!hasSelectableClass(props)) return null;
				return <BlockSelection {...(props as unknown as PlateElementProps)} />;
			},
		},
	})),
];
