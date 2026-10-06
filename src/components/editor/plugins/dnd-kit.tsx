"use client";

import { DndPlugin } from "@platejs/dnd";
import type { ReactNode } from "react";
import { DndProvider } from "react-dnd";
import { TouchBackend } from "react-dnd-touch-backend";

import { BlockDragPreview } from "@/components/editor/nodes/block/block-drag-preview";
import { BlockDraggable } from "@/components/editor/nodes/block/block-draggable";

/**
 * Pointer backend, not HTML5.
 *
 * macOS Tauri/wry swallows DOM `dragover`/`drop` (see vault-tree.md): HTML5
 * drag starts, but drop never fires. Mouse/touch move+up still work.
 */
export function EditorDndProvider({ children }: { children: ReactNode }) {
	return (
		<DndProvider
			backend={TouchBackend}
			options={{
				enableMouseEvents: true,
				enableTouchEvents: true,
				delay: 0,
				delayMouseStart: 0,
				delayTouchStart: 0,
				ignoreContextMenu: true,
				touchSlop: 6,
			}}
		>
			{children}
			<BlockDragPreview />
		</DndProvider>
	);
}

/**
 * Live-editor only. Does not handle OS file drops — those stay on the
 * existing HTML5 vault / composer / library paths.
 */
export const DndKit = [
	DndPlugin.configure({
		options: {
			enableScroller: false,
		},
		render: {
			aboveNodes: BlockDraggable,
		},
	}),
];
