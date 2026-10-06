/**
 * Shared OS file-drag highlight machinery for a drop shell.
 *
 * HTML5 dragenter is unreliable for macOS Finder / OS file drags, so the
 * shell is hit-tested on document dragover plus Tauri `onDragDropEvent`.
 * Domain hooks parameterize the payload predicates (PDF / image / …) and
 * the native-drop action; this hook owns the highlight state machine.
 */
import type { DragEvent as ReactDragEvent, RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { isClientPointInRect } from "@/lib/agent/tauri-file-drop";
import {
	dataTransferLooksLikeOsFiles,
	dataTransferLooksLikeVaultMove,
} from "@/lib/core/file-accept";
import { isVaultFileDragActive } from "@/lib/core/vault-file-drag";

export type FileDragOverlayOptions = {
	/** DataTransfer predicate gating the highlight (PDF / image / …). */
	looksLikeDrag: (dataTransfer: DataTransfer | null | undefined) => boolean;
	/**
	 * Tauri payloads carry absolute file paths (`enter`/`over`); gate the
	 * highlight on them. Empty paths are in-app HTML5 drags — return false.
	 */
	pathsMatch: (paths: string[]) => boolean;
	/**
	 * Extra selectors whose rects also light the highlight besides the shell
	 * (e.g. the whole agent panel for the composer).
	 */
	overlaySelectors?: string[];
	/**
	 * Native Tauri drop while over the shell. Return true to claim the
	 * payload so lower-priority handlers do not import it again.
	 */
	onTauriDrop?: (paths: string[]) => boolean;
};

export function useFileDragOverlay({
	looksLikeDrag,
	pathsMatch,
	overlaySelectors,
	onTauriDrop,
}: FileDragOverlayOptions) {
	const shellRef = useRef<HTMLDivElement>(null);
	const [isDragOver, setIsDragOver] = useState(false);
	// Latest-ref so listeners subscribe exactly once per mount while always
	// invoking the current-render predicates / drop action.
	const options = { looksLikeDrag, pathsMatch, overlaySelectors, onTauriDrop };
	const optionsRef = useRef(options);
	optionsRef.current = options;

	const overShell = useCallback((x: number, y: number) => {
		const el = shellRef.current;
		if (!el) return false;
		return isClientPointInRect(x, y, el.getBoundingClientRect());
	}, []);

	useEffect(() => {
		const onDragOver = (event: DragEvent) => {
			if (
				isVaultFileDragActive() ||
				dataTransferLooksLikeVaultMove(event.dataTransfer)
			) {
				setIsDragOver(false);
				return;
			}
			if (!dataTransferLooksLikeOsFiles(event.dataTransfer)) return;
			if (!overShell(event.clientX, event.clientY)) {
				setIsDragOver(false);
				return;
			}
			if (!optionsRef.current.looksLikeDrag(event.dataTransfer)) {
				setIsDragOver(false);
				return;
			}
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
			setIsDragOver(true);
		};
		const onDragLeave = (event: DragEvent) => {
			if (event.relatedTarget) return;
			setIsDragOver(false);
		};
		const clear = () => setIsDragOver(false);
		document.addEventListener("dragover", onDragOver);
		document.addEventListener("dragleave", onDragLeave);
		window.addEventListener("dragend", clear);
		window.addEventListener("drop", clear, true);
		return () => {
			document.removeEventListener("dragover", onDragOver);
			document.removeEventListener("dragleave", onDragLeave);
			window.removeEventListener("dragend", clear);
			window.removeEventListener("drop", clear, true);
		};
	}, [overShell]);

	const onDragEnter = useCallback((event: ReactDragEvent) => {
		if (dataTransferLooksLikeVaultMove(event.dataTransfer)) return;
		if (!optionsRef.current.looksLikeDrag(event.dataTransfer)) return;
		event.preventDefault();
		setIsDragOver(true);
	}, []);

	const onDragLeave = useCallback((event: ReactDragEvent) => {
		if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
			return;
		}
		setIsDragOver(false);
	}, []);

	const onDragOver = useCallback((event: ReactDragEvent) => {
		if (dataTransferLooksLikeVaultMove(event.dataTransfer)) return;
		if (!optionsRef.current.looksLikeDrag(event.dataTransfer)) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
	}, []);

	const resetDragOver = useCallback(() => {
		setIsDragOver(false);
	}, []);

	return {
		shellRef: shellRef as RefObject<HTMLDivElement>,
		isDragOver,
		resetDragOver,
		onDragEnter,
		onDragLeave,
		onDragOver,
	};
}
