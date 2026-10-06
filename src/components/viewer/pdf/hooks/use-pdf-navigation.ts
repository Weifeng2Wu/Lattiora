/**
 * Page navigation and reading position.
 *
 * Grouped because they are one user-visible behaviour: the page field, jumping
 * to a page, and the "reopen where I left off" pair (restore once the document
 * reports its page count, then persist debounced as the user scrolls). The
 * restore must run exactly once per document, which is why it owns
 * `restoredRef` rather than reading it from the shell.
 */

import type { useScroll } from "@embedpdf/plugin-scroll/react";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
	clearPendingPdfPage,
	consumePendingPdfPage,
	peekPendingPdfPage,
} from "@/lib/pdf/pending-pdf-page";
import { readReadingPage, writeReadingPage } from "@/lib/pdf/reading-position";

/** Debounce for persisting the last read page while scrolling. */
const READING_POSITION_SAVE_MS = 400;

type ScrollCapability = ReturnType<typeof useScroll>["provides"];

export type UsePdfNavigationOptions = {
	/** Stable per-paper key for the stored reading position (null = no memory). */
	paperKey: string | null;
	currentPage: number;
	totalPages: number;
	scroll: ScrollCapability;
	/** Capability ref: the restore effect must not depend on a fresh scope. */
	scrollRef: RefObject<ScrollCapability>;
	/** Primitive readiness flag, safe as an effect dependency. */
	scrollReady: boolean;
};

export type PdfNavigation = {
	/** Toolbar input value (page text, not a number). */
	pageField: string;
	setPageField: (value: string) => void;
	/** True while the input has focus; blocks the observed-page sync. */
	pageFocusedRef: RefObject<boolean>;
	/** Clamp and jump; also the outline / citation jump target. */
	goToPage: (page: number) => void;
	/** Apply the typed page (falls back to the current page). */
	commitPageField: () => void;
};

export function usePdfNavigation({
	paperKey,
	currentPage,
	totalPages,
	scroll,
	scrollRef,
	scrollReady,
}: UsePdfNavigationOptions): PdfNavigation {
	const [pageField, setPageField] = useState("1");
	const pageFocusedRef = useRef(false);
	const restoredRef = useRef(false);

	// Keep the page-number input in sync with the observed current page.
	useEffect(() => {
		if (!pageFocusedRef.current) setPageField(String(currentPage));
	}, [currentPage]);

	// On first load: prefer a one-shot citation/wiki page intent, else restore
	// the last read page. Citation jumps race with this effect — without the
	// pending intent, an early `#page=N` scroll is overwritten by restore (or
	// by EmbedPDF finishing layout back at page 1).
	// biome-ignore lint/correctness/useExhaustiveDependencies: scrollReady waits for EmbedPDF scope
	useEffect(() => {
		const scrollScope = scrollRef.current;
		if (restoredRef.current || totalPages <= 0 || !scrollScope) return;

		if (paperKey) {
			const pending = peekPendingPdfPage(paperKey);
			if (pending != null && pending >= 1 && pending <= totalPages) {
				restoredRef.current = true;
				consumePendingPdfPage(paperKey);
				scrollScope.scrollToPage({
					pageNumber: pending,
					behavior: "instant",
				});
				return;
			}
			if (pending != null) {
				// Out-of-range citation page — drop it and fall through to saved.
				clearPendingPdfPage(paperKey);
			}
		}

		// Guard against the restore firing after the user has already scrolled.
		// On Windows the EmbedPDF scroll plugin may report readiness late (e.g.
		// while the viewport is still settling with fractional DPR), in which case
		// scrolling to the saved page would yank the view back to an earlier
		// position while the user is actively paging through the document.
		try {
			const metrics = scrollScope.getMetrics();
			if (metrics && metrics.currentPage > 1) {
				restoredRef.current = true;
				return;
			}
		} catch {
			// Viewport metrics may not be available yet; fall through and restore.
		}

		restoredRef.current = true;
		if (paperKey) {
			const saved = readReadingPage(paperKey);
			if (saved && saved > 1 && saved <= totalPages) {
				scrollScope.scrollToPage({
					pageNumber: saved,
					behavior: "instant",
				});
			}
		}
	}, [totalPages, scrollReady, paperKey]);

	// Persist the last read page (debounced) as the user scrolls.
	useEffect(() => {
		if (!paperKey || !restoredRef.current || currentPage < 1) return;
		const id = setTimeout(() => {
			writeReadingPage(paperKey, currentPage);
		}, READING_POSITION_SAVE_MS);
		return () => clearTimeout(id);
	}, [paperKey, currentPage]);

	const goToPage = (n: number) => {
		if (!scroll || totalPages <= 0) return;
		const clamped = Math.min(totalPages, Math.max(1, Math.floor(n)));
		scroll.scrollToPage({ pageNumber: clamped, behavior: "instant" });
	};

	const commitPageField = () => {
		const n = Number.parseInt(pageField, 10);
		if (Number.isFinite(n)) goToPage(n);
		else setPageField(String(currentPage));
	};

	return {
		pageField,
		setPageField,
		pageFocusedRef,
		goToPage,
		commitPageField,
	};
}
