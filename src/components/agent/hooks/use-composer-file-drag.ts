/**
 * Image drop highlight for the composer shell.
 *
 * Overlay machinery (macOS-safe document dragover hit-testing + Tauri
 * `onDragDropEvent` state machine) lives in `useFileDragOverlay`. The
 * highlight also covers the whole agent panel; the native attach itself
 * happens in `ComposerDropTarget`.
 */
import { useFileDragOverlay } from "@/hooks/use-file-drag-overlay";
import {
	dataTransferLooksLikeImages,
	hasImageExtension,
} from "@/lib/core/file-accept";

const OVERLAY_SELECTORS = ["[data-agent-panel]"];

export function useComposerFileDrag() {
	const {
		shellRef,
		isDragOver,
		resetDragOver,
		onDragEnter,
		onDragLeave,
		onDragOver,
	} = useFileDragOverlay({
		looksLikeDrag: dataTransferLooksLikeImages,
		// Empty paths are in-app HTML5 drags or unknown — do not flash overlay.
		pathsMatch: (paths) => paths.some((path) => hasImageExtension(path)),
		overlaySelectors: OVERLAY_SELECTORS,
	});

	return {
		shellRef,
		isFileDragOver: isDragOver,
		onFileDragEnter: onDragEnter,
		onFileDragLeave: onDragLeave,
		onFileDragOver: onDragOver,
		onFileDropHighlightEnd: resetDragOver,
	};
}
