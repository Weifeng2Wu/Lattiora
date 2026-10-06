/**
 * DOM text selection → Copy / Ask / Add-to-chat for Plaza feed detail.
 * Ask is ephemeral (in-memory PdfAskThread + AskPopover); nothing writes marks/.
 * The ask run lifecycle lives in the shared `useSelectionAsk`.
 */

import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { PlazaSelectionScreen } from "@/components/plaza/plaza-selection-menu";
import { addSelectionToChat } from "@/components/selection/add-selection-to-chat";
import { useCopiedLabel } from "@/components/selection/use-copied-label";
import {
	createSelectionAskThread,
	useSelectionAsk,
} from "@/components/selection/use-selection-ask";
import { useSelectionQuickChat } from "@/components/selection/use-selection-quick-chat";
import { copyTextToClipboard } from "@/lib/core/clipboard";
import type { PdfAskThread } from "@/lib/pdf/ask/types";
import { buildPlazaAskPrompt } from "@/lib/plaza/ask-prompt";
import type { FeedItem } from "@/lib/plaza/feeds";

const MAX_SELECTION_CHARS = 4000;

export type PlazaFeedSelectionMenu = {
	text: string;
	screen: PlazaSelectionScreen;
};

export type PlazaFeedAskState = {
	thread: PdfAskThread;
	screen: PlazaSelectionScreen;
};

function selectionInside(root: HTMLElement, sel: Selection): boolean {
	if (sel.rangeCount === 0) return false;
	const node = sel.getRangeAt(0).commonAncestorContainer;
	const el =
		node.nodeType === Node.ELEMENT_NODE ? (node as Node) : node.parentNode;
	return Boolean(el && root.contains(el));
}

function selectionScreen(sel: Selection): PlazaSelectionScreen | null {
	if (sel.rangeCount === 0) return null;
	const rect = sel.getRangeAt(0).getBoundingClientRect();
	if (rect.width === 0 && rect.height === 0) return null;
	return { x: rect.left + rect.width / 2, y: rect.top };
}

export function usePlazaFeedSelection({
	item,
	bodyRef,
}: {
	item: FeedItem;
	bodyRef: RefObject<HTMLElement | null>;
}) {
	const [menu, setMenu] = useState<PlazaFeedSelectionMenu | null>(null);
	const { copiedLabelPos, showCopiedLabel, clearCopiedLabel } =
		useCopiedLabel();
	const mouseUpPosRef = useRef<{ x: number; y: number } | null>(null);

	// Viewer-wide single-run slot (ask cluster only on this surface).
	const activeSessionRef = useRef<string | null>(null);

	const askCtl = useSelectionAsk<PlazaSelectionScreen>({
		buildPrompt: (thread, question) =>
			buildPlazaAskPrompt(thread, question, {
				title: item.title,
				url: item.url ?? item.paperUrl,
			}),
		activeSessionRef,
	});
	const { ask, streaming, askError, resetAsk, setAsk } = askCtl;

	// New item → drop selection chrome.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run on item navigation
	useEffect(() => {
		setMenu(null);
		resetAsk();
		clearCopiedLabel();
	}, [item.id, clearCopiedLabel, resetAsk]);

	const clearNativeSelection = useCallback(() => {
		const sel = window.getSelection();
		sel?.removeAllRanges();
	}, []);

	const closeMenu = useCallback(() => {
		setMenu(null);
		clearCopiedLabel();
	}, [clearCopiedLabel]);

	const captureSelection = useCallback(() => {
		const root = bodyRef.current;
		if (!root) return;
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !selectionInside(root, sel)) {
			setMenu(null);
			return;
		}
		const text = sel
			.toString()
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, MAX_SELECTION_CHARS);
		if (!text) {
			setMenu(null);
			return;
		}
		const screen = selectionScreen(sel);
		if (!screen) {
			setMenu(null);
			return;
		}
		setMenu({ text, screen });
		void copyTextToClipboard(text);
		showCopiedLabel(mouseUpPosRef.current);
	}, [bodyRef, showCopiedLabel]);

	useEffect(() => {
		const root = bodyRef.current;
		if (!root) return;

		const onMouseUp = (event: MouseEvent) => {
			mouseUpPosRef.current = { x: event.clientX, y: event.clientY };
			// Defer so the browser finishes updating the selection.
			requestAnimationFrame(() => captureSelection());
		};
		const onKeyUp = (event: KeyboardEvent) => {
			if (event.key === "Shift" || event.key.startsWith("Arrow")) {
				requestAnimationFrame(() => captureSelection());
			}
		};
		const onScroll = () => {
			setMenu(null);
		};
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (!target) return;
			// Keep menu when interacting with the toolbar / ask card.
			if (
				(target as Element).closest?.(
					"[data-plaza-selection-menu], [data-plaza-ask-card]",
				)
			) {
				return;
			}
			// Click outside the body clears the menu (selection may collapse next).
			if (!root.contains(target)) {
				setMenu(null);
			}
		};

		root.addEventListener("mouseup", onMouseUp);
		root.addEventListener("keyup", onKeyUp);
		root.addEventListener("scroll", onScroll, true);
		document.addEventListener("pointerdown", onPointerDown, true);
		return () => {
			root.removeEventListener("mouseup", onMouseUp);
			root.removeEventListener("keyup", onKeyUp);
			root.removeEventListener("scroll", onScroll, true);
			document.removeEventListener("pointerdown", onPointerDown, true);
		};
	}, [bodyRef, captureSelection]);

	const sourcePath =
		item.url?.trim() ||
		item.paperUrl?.trim() ||
		item.title.trim() ||
		`feed:${item.id}`;

	const handleAddToChat = useCallback(() => {
		if (!menu) return;
		const text = menu.text;
		setMenu(null);
		clearNativeSelection();
		addSelectionToChat({ text, sourcePath, origin: "markdown" });
	}, [menu, sourcePath, clearNativeSelection]);

	const handleAsk = useCallback(() => {
		if (!menu) return;
		const { text, screen } = menu;
		setMenu(null);
		clearNativeSelection();
		setAsk({
			thread: createSelectionAskThread(sourcePath, text),
			screen,
		});
	}, [menu, sourcePath, clearNativeSelection, setAsk]);

	// ⌘K Quick chat — while this Plaza selection toolbar is armed.
	useSelectionQuickChat(() => menu != null, handleAsk);

	return {
		menu,
		ask,
		streaming,
		askError,
		closeMenu,
		handleAsk,
		handleAddToChat,
		sendAskQuestion: askCtl.sendAskQuestion,
		resendAskQuestion: askCtl.resendAskQuestion,
		hideAsk: askCtl.hideAsk,
		deleteAsk: askCtl.deleteAsk,
		stopAskStreaming: askCtl.stopAskStreaming,
		copiedLabelPos,
		itemTitle: item.title,
		itemLink: item.url ?? item.paperUrl ?? undefined,
	};
}
