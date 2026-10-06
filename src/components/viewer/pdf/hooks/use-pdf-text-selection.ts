import { tightenFormattedSelection } from "@/lib/pdf/selection-appearance";
/**
 * Text-selection detection for the EmbedPDF viewer: turning an EmbedPDF drag
 * selection into a placed floating action menu, publishing the selected text to
 * the Agent selection store, and making ⌘/Ctrl+C copy the *PDF* selection.
 *
 * Only detection, placement and menu state live here. The menu's actions
 * (highlight / note / ask / add-to-chat / translate) each belong to another
 * cluster, so they stay with their owners and are passed into the menu by the
 * parent — this hook just says where the menu is and clears it.
 *
 * The copy interception exists because a PDFium text selection is not a DOM
 * selection: the browser has nothing to copy. It is installed only while a menu
 * is open on the active tab, and defers to any real editable target or native
 * selection outside the viewer host so it cannot steal a normal copy.
 */

import type { useDocumentManagerCapability } from "@embedpdf/plugin-document-manager/react";
import type {
	FormattedSelection,
	useSelectionCapability,
} from "@embedpdf/plugin-selection/react";
import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
	useState,
} from "react";
import {
	anchorFromEmbedSelection,
	pageElByIndex,
	rectTopCenterScreen,
} from "@/components/viewer/pdf/coords";
import {
	hasNativeSelectionOutsideHost,
	isEditableClipboardTarget,
} from "@/components/viewer/pdf/host-dom";
import type {
	ScreenPoint,
	SelectionMenuState,
} from "@/components/viewer/pdf/types";
import {
	clearActiveSelection,
	publishSelection,
} from "@/lib/agent/selection-store";

type SelectionCapabilityProvides = ReturnType<
	typeof useSelectionCapability
>["provides"];

type DocumentManagerCapability = ReturnType<
	typeof useDocumentManagerCapability
>["provides"];

/** Pick the page the floating menu should track (cursor-end page when known). */
function menuAnchorPage(
	pages: FormattedSelection[],
	preferredPageIndex?: number,
): FormattedSelection | null {
	if (!pages.length) return null;
	if (preferredPageIndex != null) {
		const match = pages.find((p) => p.pageIndex === preferredPageIndex);
		if (match) return match;
	}
	return pages[pages.length - 1] ?? pages[0] ?? null;
}

/** Map a formatted selection page to the floating toolbar screen anchor. */
function menuScreenPoint(
	host: HTMLElement | null,
	anchorPage: FormattedSelection,
	zoom: number,
): ScreenPoint | null {
	const pageEl = pageElByIndex(host, anchorPage.pageIndex);
	if (!pageEl) return null;
	return rectTopCenterScreen(pageEl, anchorPage.rect, zoom);
}

export type UsePdfTextSelectionOptions = {
	/** EmbedPDF capabilities; owned by `PdfViewerInner` (plugin context). */
	selectionCap: SelectionCapabilityProvides;
	docCap: DocumentManagerCapability;
	docId: string;
	hostRef: RefObject<HTMLDivElement | null>;
	/** Current zoom, mirrored so menu placement never re-subscribes. */
	zoomRef: RefObject<number>;
	/** Only the active tab may hijack copy. */
	isActive: boolean;
	/** Provenance for the published selection (Agent chips / conversation pins). */
	paperRelPath: string | null;
	paperAbsPath: string | null;
};

export type PdfTextSelection = {
	selectionMenu: SelectionMenuState | null;
	setSelectionMenu: Dispatch<SetStateAction<SelectionMenuState | null>>;
	/**
	 * True while the pointer is mid drag-select (between EmbedPDF begin/end).
	 * Used to suppress ephemeral link previews that would otherwise pop while
	 * the selection sweeps across citation / crossref hit targets.
	 */
	isSelecting: boolean;
	/** Dismiss the menu and drop the underlying PDFium selection. */
	closeSelectionMenu: () => void;
	/**
	 * Recompute the toolbar screen anchor from the live page DOM.
	 * Call on viewport scroll and zoom so the menu stays glued to the selection.
	 */
	rePlaceSelectionMenu: () => void;
};

export function usePdfTextSelection({
	selectionCap,
	docCap,
	docId,
	hostRef,
	zoomRef,
	isActive,
	paperRelPath,
	paperAbsPath,
}: UsePdfTextSelectionOptions): PdfTextSelection {
	const [selectionMenu, setSelectionMenu] = useState<SelectionMenuState | null>(
		null,
	);
	const [isSelecting, setIsSelecting] = useState(false);

	const closeSelectionMenu = useCallback(() => {
		setSelectionMenu(null);
		selectionCap?.clear(docId);
	}, [selectionCap, docId]);

	const rePlaceSelectionMenu = useCallback(() => {
		setSelectionMenu((prev) => {
			if (!prev) return prev;
			const anchorPage = menuAnchorPage(prev.pages, prev.anchor.page - 1);
			if (!anchorPage) return prev;
			const screen = menuScreenPoint(
				hostRef.current,
				anchorPage,
				zoomRef.current,
			);
			if (!screen) return prev;
			if (screen.x === prev.screen.x && screen.y === prev.screen.y) {
				return prev;
			}
			return { ...prev, screen };
		});
	}, [hostRef, zoomRef]);

	// Show the selection action menu when a drag-selection ends.
	useEffect(() => {
		if (!selectionCap || !docCap) return;

		const scope = selectionCap.forDocument(docId);
		const offBegin = scope.onBeginSelection(() => {
			setIsSelecting(true);
		});
		const offEnd = scope.onEndSelection(() => {
			const rawPages = selectionCap.getFormattedSelection(docId);
			if (!rawPages.length) {
				setIsSelecting(false);
				setSelectionMenu(null);
				return;
			}

			// Anchor the toolbar to the page where the cursor ended. For cross-page
			// selections the first page may be scrolled out of view, which makes the
			// toolbar appear off-screen and seem missing.
			const state = selectionCap.getState(docId);
			const pages = tightenFormattedSelection(
				rawPages,
				state.geometry,
				state.selection,
			);
			const endPage = state.selection?.end?.page ?? null;
			const anchorPage = menuAnchorPage(
				pages,
				endPage != null ? endPage : undefined,
			);
			if (!anchorPage) {
				setIsSelecting(false);
				return;
			}

			const screen = menuScreenPoint(
				hostRef.current,
				anchorPage,
				zoomRef.current,
			);
			if (!screen) {
				setIsSelecting(false);
				return;
			}
			// Keep isSelecting true across the async quote extract so link
			// previews cannot flash between mouseup and the selection menu.
			void (async () => {
				let quote = "";
				try {
					const lines = await selectionCap.getSelectedText(docId).toPromise();
					quote = (lines ?? []).join(" ").replace(/\s+/g, " ").trim();
				} catch {
					// text extraction is best-effort
				}
				const doc = docCap.getDocument(docId);
				const anchor = anchorFromEmbedSelection(
					pages,
					quote,
					(pageIndex) => doc?.pages[pageIndex]?.size ?? null,
					"selection",
					anchorPage.pageIndex,
				);
				if (!anchor) {
					setIsSelecting(false);
					return;
				}
				setSelectionMenu({ screen, anchor, pages });
				setIsSelecting(false);
				publishSelection({
					text: quote,
					sourcePath: paperRelPath ?? paperAbsPath ?? "PDF",
					origin: "pdf",
					page: anchor.page,
					rects: anchor.rects,
					paperAbsPath: paperAbsPath ?? undefined,
				});
			})();
		});
		const offChange = scope.onSelectionChange((sel) => {
			if (!sel) {
				setIsSelecting(false);
				setSelectionMenu(null);
				clearActiveSelection("pdf");
			}
		});
		return () => {
			offBegin();
			offEnd();
			offChange();
			setIsSelecting(false);
			clearActiveSelection("pdf");
		};
	}, [
		selectionCap,
		docCap,
		docId,
		paperRelPath,
		paperAbsPath,
		hostRef,
		zoomRef,
	]);

	// PDFium selections are invisible to the browser: intercept copy so ⌘/Ctrl+C
	// yields the selected PDF text instead of nothing.
	useEffect(() => {
		if (!isActive || !selectionMenu || !selectionCap) return;
		const selectedText = selectionMenu.anchor.quote ?? "";
		if (!selectedText.trim()) return;
		const host = hostRef.current;

		const shouldHandlePdfCopy = (target: EventTarget | null): boolean => {
			if (isEditableClipboardTarget(target)) return false;
			if (hasNativeSelectionOutsideHost(host)) return false;
			return true;
		};

		const onCopy = (event: ClipboardEvent) => {
			if (!shouldHandlePdfCopy(event.target)) return;
			event.preventDefault();
			event.clipboardData?.setData("text/plain", selectedText);
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey)) return;
			if (event.shiftKey || event.altKey || event.key.toLowerCase() !== "c")
				return;
			if (!shouldHandlePdfCopy(event.target)) return;
			event.preventDefault();
			selectionCap.copyToClipboard(docId);
		};

		document.addEventListener("copy", onCopy);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("copy", onCopy);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [isActive, selectionMenu, selectionCap, docId, hostRef]);

	return {
		selectionMenu,
		setSelectionMenu,
		isSelecting,
		closeSelectionMenu,
		rePlaceSelectionMenu,
	};
}
