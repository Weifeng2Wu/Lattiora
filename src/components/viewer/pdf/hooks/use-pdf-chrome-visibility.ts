import type { ScrollScope } from "@embedpdf/plugin-scroll";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

/** Keep the chrome visible this long after the last scroll event. */
const HIDE_AFTER_SCROLL_MS = 1200;
/** Grace period after the pointer leaves the top zone before hiding. */
const HIDE_AFTER_LEAVE_MS = 400;
/** Distance from the viewer top edge (px) that counts as "near the chrome". */
const TOP_ZONE_PX = 48;

type UsePdfChromeVisibilityOptions = {
	/** Viewer root; pointer proximity is measured against its top edge. */
	hostRef: RefObject<HTMLDivElement | null>;
	/** Latest EmbedPDF scroll scope (fresh object per render — read only). */
	scrollRef: RefObject<ScrollScope | null>;
	/** Primitive readiness of the scroll scope; re-subscribe trigger. */
	scrollReady: boolean;
	/** While true the chrome stays visible (open panels, find bar, marquee…). */
	sticky: boolean;
	/** Last-chance veto evaluated at hide time (e.g. zoom field focus). */
	held?: () => boolean;
};

/**
 * Auto show/hide for the floating PDF left toolbar (issue #400): the chrome
 * appears while the viewport scrolls and while the pointer is near the top
 * edge, then fades out once reading resumes. The top-right toolbar stays pinned.
 */
export function usePdfChromeVisibility({
	hostRef,
	scrollRef,
	scrollReady,
	sticky,
	held,
}: UsePdfChromeVisibilityOptions) {
	const [visible, setVisible] = useState(true);
	const hideTimerRef = useRef<number | null>(null);
	const nearTopRef = useRef(false);
	const stickyRef = useRef(sticky);
	stickyRef.current = sticky;
	const heldRef = useRef(held);
	heldRef.current = held;

	const cancelHide = useCallback(() => {
		if (hideTimerRef.current != null) {
			window.clearTimeout(hideTimerRef.current);
			hideTimerRef.current = null;
		}
	}, []);

	const scheduleHide = useCallback(
		(delay: number) => {
			cancelHide();
			hideTimerRef.current = window.setTimeout(() => {
				hideTimerRef.current = null;
				if (stickyRef.current || nearTopRef.current) return;
				if (heldRef.current?.()) return;
				setVisible(false);
			}, delay);
		},
		[cancelHide],
	);

	// Open panels / find bar / region marquee keep the chrome pinned.
	const prevStickyRef = useRef(sticky);
	useEffect(() => {
		const wasSticky = prevStickyRef.current;
		prevStickyRef.current = sticky;
		if (sticky) {
			cancelHide();
			setVisible(true);
		} else if (wasSticky) {
			scheduleHide(HIDE_AFTER_SCROLL_MS);
		}
	}, [sticky, cancelHide, scheduleHide]);

	// Show while scrolling; fade out shortly after scrolling settles.
	useEffect(() => {
		if (!scrollReady) return;
		const scope = scrollRef.current;
		if (!scope) return;
		return scope.onScroll(() => {
			setVisible(true);
			scheduleHide(HIDE_AFTER_SCROLL_MS);
		});
	}, [scrollReady, scrollRef, scheduleHide]);

	// Pointer near the top edge keeps the chrome visible.
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const handleMove = (event: MouseEvent) => {
			const near =
				event.clientY - host.getBoundingClientRect().top <= TOP_ZONE_PX;
			if (near) {
				nearTopRef.current = true;
				cancelHide();
				setVisible(true);
			} else {
				nearTopRef.current = false;
				scheduleHide(HIDE_AFTER_LEAVE_MS);
			}
		};
		const handleLeave = () => {
			if (!nearTopRef.current) return;
			nearTopRef.current = false;
			scheduleHide(HIDE_AFTER_LEAVE_MS);
		};
		host.addEventListener("mousemove", handleMove);
		host.addEventListener("mouseleave", handleLeave);
		return () => {
			host.removeEventListener("mousemove", handleMove);
			host.removeEventListener("mouseleave", handleLeave);
		};
	}, [hostRef, cancelHide, scheduleHide]);

	useEffect(() => cancelHide, [cancelHide]);

	return visible;
}
