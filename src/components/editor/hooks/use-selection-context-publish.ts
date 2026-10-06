"use client";

import { RangeApi } from "platejs";
import type { PlateEditor } from "platejs/react";
import { type RefObject, useEffect } from "react";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import {
	clearActiveSelection,
	publishSelection,
} from "@/lib/agent/selection-store";
import {
	hasSelectedBlocks,
	serializeSelectedBlocksAsMarkdown,
} from "@/lib/markdown/block-selection";

const PUBLISH_DEBOUNCE_MS = 300;

/**
 * Mirror the live text selection into the Agent composer as an ephemeral
 * context chip. Debounced because dragging a selection fires continuously;
 * a collapsed selection clears the chip instead of publishing an empty one.
 *
 * Returns the scheduler to call whenever the selection may have moved.
 */
export function useSelectionContextPublish({
	editor,
	filePathRef,
}: {
	editor: PlateEditor;
	filePathRef: RefObject<string | null>;
}): () => void {
	const schedule = useDebouncedCallback(() => {
		const path = filePathRef.current;
		if (!path) {
			clearActiveSelection("markdown");
			return;
		}
		if (hasSelectedBlocks(editor)) {
			publishSelection({
				text: serializeSelectedBlocksAsMarkdown(editor),
				sourcePath: path,
				origin: "markdown",
			});
			return;
		}
		const selection = editor.selection;
		if (!selection || RangeApi.isCollapsed(selection)) {
			clearActiveSelection("markdown");
			return;
		}
		publishSelection({
			text: editor.api.string(selection),
			sourcePath: path,
			origin: "markdown",
		});
	}, PUBLISH_DEBOUNCE_MS);

	useEffect(() => {
		return () => {
			schedule.cancel();
			clearActiveSelection("markdown");
		};
	}, [schedule]);

	return schedule;
}
