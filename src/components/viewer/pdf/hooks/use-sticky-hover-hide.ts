/**
 * Sticky hover-hide state machine shared by the PDF floating cards: the pin
 * card (`usePdfCards`), the citation preview (`usePdfCitations`) and the
 * crossref preview (`usePdfCrossrefPreview`).
 *
 * The pointer must be able to travel from the anchor (link / pin) into the
 * floating card, so hiding is delayed by `delayMs` and dropped whenever a
 * hover surface marks itself entered. When the timer fires, a still-active
 * floating dialog (hovered or focused `role="dialog"`) re-arms the surface
 * instead of dismissing, an optional `hold` veto runs last, and only then
 * does `hide()` dismiss the card.
 *
 * The hook owns no cleanup effect: consumers decide when a doc switch or
 * unmount should cancel the timer (mirroring the pre-extracted hooks).
 */

import { type RefObject, useCallback, useRef } from "react";
import { isFloatingDialogActive } from "@/components/viewer/pdf/floating-hover";

export type StickyHoverHide = {
	/** True while the pointer is over a surface that keeps the card open. */
	hoverSurfaceRef: RefObject<boolean>;
	/** Drop a pending hide timer without touching the hover surface. */
	cancelHide: () => void;
	/** Pointer entered a hover surface (card / pin / import menu). */
	markHoverEnter: () => void;
	/** Pointer left — hide after the delay unless a surface holds it open. */
	scheduleHide: () => void;
};

export type UseStickyHoverHideOptions = {
	/** Grace period for the pointer to travel from the anchor into the card. */
	delayMs: number;
	/** Dismiss callback, invoked only when nothing holds the card open. */
	hide: () => void;
	/** Extra fire-time veto (e.g. a translate run still streaming). */
	hold?: () => boolean;
};

export function useStickyHoverHide({
	delayMs,
	hide,
	hold,
}: UseStickyHoverHideOptions): StickyHoverHide {
	const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const hoverSurfaceRef = useRef(false);

	const cancelHide = useCallback(() => {
		if (!hideTimerRef.current) return;
		clearTimeout(hideTimerRef.current);
		hideTimerRef.current = null;
	}, []);

	const markHoverEnter = useCallback(() => {
		hoverSurfaceRef.current = true;
		cancelHide();
	}, [cancelHide]);

	const scheduleHide = useCallback(() => {
		hoverSurfaceRef.current = false;
		cancelHide();
		hideTimerRef.current = setTimeout(() => {
			hideTimerRef.current = null;
			if (hoverSurfaceRef.current) return;
			// Still interacting with the floating modal.
			if (isFloatingDialogActive()) {
				hoverSurfaceRef.current = true;
				return;
			}
			if (hold?.()) return;
			hide();
		}, delayMs);
	}, [cancelHide, delayMs, hide, hold]);

	return { hoverSurfaceRef, cancelHide, markHoverEnter, scheduleHide };
}
