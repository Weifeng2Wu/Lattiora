import { quoteContextFromText } from "@/lib/agent/selection-context";
import { layoutAnalysisStore } from "@/lib/pdf/layout/store";
/**
 * Selection actions (highlight / note / copy / ask / add-to-chat / translate).
 *
 * Highlight / ask (quick chat) / add-to-chat / translate are wired to the
 * floating selection toolbar; note is typed on the right-rail selection
 * comment chip and committed from there.
 * Detection and menu state stay in {@link usePdfTextSelection}; each action's
 * real work belongs to its own cluster.
 */

import type {
	FormattedSelection,
	useSelectionCapability,
} from "@embedpdf/plugin-selection/react";
import { type Dispatch, type SetStateAction, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSelectionQuickChat } from "@/components/selection/use-selection-quick-chat";
import type { SelectionMenuState } from "@/components/viewer/pdf/types";
import { annotationPdfAnchors } from "@/lib/agent/selection-annotations";
import {
	openSelectionChat,
	selectionChatStore,
} from "@/lib/agent/selection-chat-store";
import { copyTextToClipboard } from "@/lib/core/clipboard";
import type { PdfAskAnchor } from "@/lib/pdf/ask/types";
import {
	DEFAULT_HIGHLIGHT_COLOR,
	type HighlightColor,
} from "@/lib/pdf/highlight/palette";

type SelectionCapabilityProvides = ReturnType<
	typeof useSelectionCapability
>["provides"];

export type UsePdfSelectionActionsOptions = {
	/** Placed menu; every action no-ops when null. */
	selectionMenu: SelectionMenuState | null;
	setSelectionMenu: Dispatch<SetStateAction<SelectionMenuState | null>>;
	closeSelectionMenu: () => void;
	/** Highlights cluster writer. */
	createHighlights: (
		pages: FormattedSelection[],
		color: HighlightColor,
		quote: string,
	) => { pageIndex: number; id: string }[];
	/** Write the note body onto a freshly created highlight. */
	updateHighlightComment: (
		pageIndex: number,
		id: string,
		comment: string,
	) => void;
	/** EmbedPDF capability; owned by `PdfViewerInner` (plugin context). */
	selectionCap: SelectionCapabilityProvides;
	docId: string;
	/** Ask cluster entry (creates an empty thread from the anchor). */
	startFromAnchor: (anchor: PdfAskAnchor) => void;
	/** Translate cluster entry (creates the record and starts the run). */
	translateSelection: (anchor: PdfAskAnchor) => void;
	paperRelPath: string | null;
	paperAbsPath: string | null;
};

export type PdfSelectionActions = {
	handleHighlight: (color: HighlightColor) => void;
	/**
	 * Create a highlight + comment from a snapped selection draft. Used by the
	 * right-rail chip so typing can survive EmbedPDF clearing the live selection.
	 */
	handleCommitSelectionNote: (
		draft: {
			pages: FormattedSelection[];
			quote: string;
		},
		comment: string,
	) => void;
	handleMenuAsk: () => void;
	handleMenuAddToChat: () => void;
	handleMenuTranslate: () => void;
	handleMenuCopy: () => void;
};

export function usePdfSelectionActions({
	selectionMenu,
	setSelectionMenu,
	closeSelectionMenu,
	createHighlights,
	updateHighlightComment,
	selectionCap,
	docId,
	startFromAnchor,
	translateSelection,
	paperRelPath,
	paperAbsPath,
}: UsePdfSelectionActionsOptions): PdfSelectionActions {
	// The right-rail annotate chip lives inside the page DOM. EmbedPDF often
	// clears the live selection on pointerdown before React re-renders, so
	// action handlers read this snapshot instead of the possibly-null state.
	const { t } = useTranslation("viewer");
	const selectionMenuRef = useRef(selectionMenu);
	selectionMenuRef.current = selectionMenu;

	const handleHighlight = useCallback(
		(color: HighlightColor) => {
			const menu = selectionMenuRef.current;
			if (!menu) return;
			createHighlights(menu.pages, color, menu.anchor.quote ?? "");
			closeSelectionMenu();
		},
		[createHighlights, closeSelectionMenu],
	);

	const handleCommitSelectionNote = useCallback(
		(
			draft: { pages: FormattedSelection[]; quote: string },
			comment: string,
		) => {
			const trimmed = comment.trim();
			if (!trimmed || !draft.pages.length) return;
			const created = createHighlights(
				draft.pages,
				DEFAULT_HIGHLIGHT_COLOR,
				draft.quote,
			);
			const first = created[0];
			setSelectionMenu(null);
			selectionCap?.clear(docId);
			if (!first) return;
			updateHighlightComment(first.pageIndex, first.id, trimmed);
		},
		[
			createHighlights,
			updateHighlightComment,
			selectionCap,
			docId,
			setSelectionMenu,
		],
	);

	const handleMenuAsk = useCallback(() => {
		const menu = selectionMenuRef.current;
		if (!menu) return;
		const anchor = menu.anchor;
		setSelectionMenu(null);
		selectionCap?.clear(docId);
		startFromAnchor(anchor);
	}, [startFromAnchor, selectionCap, docId, setSelectionMenu]);

	// ⌘K Quick chat — only while this viewer's selection toolbar is armed.
	useSelectionQuickChat(() => selectionMenuRef.current != null, handleMenuAsk);

	const handleMenuAddToChat = useCallback(() => {
		const menu = selectionMenuRef.current;
		if (!menu) return;
		const anchor = menu.anchor;
		const quote = anchor.quote?.trim();
		setSelectionMenu(null);
		selectionCap?.clear(docId);
		if (!quote) return;
		const regions =
			layoutAnalysisStore.getState().byDocument[docId]?.regions ?? [];
		const matches = regions.filter(
			(region) =>
				region.pageIndex === anchor.page - 1 && region.text?.includes(quote),
		);
		const context =
			matches.length === 1
				? quoteContextFromText(matches[0].text ?? "", quote)
				: { status: "unavailable" as const };
		// Keep a draft after clear: typing a comment must not depend on live selection.
		// Keep page geometry so the next Agent turn can write a conversation card pin.
		openSelectionChat(
			{
				text: quote,
				sourcePath: paperRelPath ?? paperAbsPath ?? "PDF",
				origin: "pdf",
				context,
				page: anchor.page,
				rects: anchor.rects,
				paperAbsPath: paperAbsPath ?? undefined,
			},
			menu.screen,
		);
		const id = selectionChatStore.getState().draft?.selection.id;
		const rect = menu.anchor.rects?.at(-1);
		if (id && rect)
			annotationPdfAnchors.set(id, {
				documentId: docId,
				page: menu.anchor.page,
				rect: { ...rect },
			});
	}, [selectionCap, docId, paperRelPath, paperAbsPath, setSelectionMenu]);

	const handleMenuTranslate = useCallback(() => {
		const menu = selectionMenuRef.current;
		if (!menu) return;
		const anchor = menu.anchor;
		setSelectionMenu(null);
		selectionCap?.clear(docId);
		translateSelection(anchor);
	}, [selectionCap, docId, setSelectionMenu, translateSelection]);

	const handleMenuCopy = useCallback(() => {
		const menu = selectionMenuRef.current;
		if (!menu) return;
		const quote = menu.anchor.quote?.trim();
		if (!quote) return;
		void copyTextToClipboard(quote, {
			successMessage: t("selection.copied"),
		});
		setSelectionMenu(null);
		selectionCap?.clear(docId);
	}, [t, setSelectionMenu, selectionCap, docId]);

	return {
		handleHighlight,
		handleCommitSelectionNote,
		handleMenuAsk,
		handleMenuAddToChat,
		handleMenuTranslate,
		handleMenuCopy,
	};
}
