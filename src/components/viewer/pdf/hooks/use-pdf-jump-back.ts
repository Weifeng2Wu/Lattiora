/**
 * "Jump back" for internal PDF link jumps (issue #505): clicking an in-text
 * reference (Appendix, figure, citation …) scrolls the reader far away with no
 * way back. Every accepted jump pushes the pre-jump viewport position onto a
 * stack; a floating chip restores it.
 *
 * Own hook because it is one self-contained state machine around the viewport
 * capability: capture → commit (only when the link actually navigated) → pop.
 * Scrolling deliberately does NOT clear the stack — the whole point is to read
 * the appendix for a while, then return.
 */

import { useScrollCapability } from "@embedpdf/plugin-scroll/react";
import { useViewportCapability } from "@embedpdf/plugin-viewport/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	createJumpBackStack,
	type JumpBackStack,
	type JumpOrigin,
	popJumpOrigin,
	pushJumpOrigin,
} from "@/lib/pdf/jump-back-stack";

const EMPTY_STACK = createJumpBackStack();

export type UsePdfJumpBackOptions = {
	docId: string;
};

export type PdfJumpBack = {
	/** Origin the chip would restore right now (null = chip hidden). */
	backTarget: JumpOrigin | null;
	/** Read the viewport before `navigateTarget` fires. */
	captureJumpOrigin: () => void;
	/** Push the captured origin; call only when the link actually navigated. */
	commitJumpOrigin: () => void;
	/** Restore the newest origin and pop it. */
	goBack: () => void;
};

export function usePdfJumpBack({ docId }: UsePdfJumpBackOptions): PdfJumpBack {
	const viewportCap = useViewportCapability().provides;
	const scrollCap = useScrollCapability().provides;
	const [stack, setStack] = useState<JumpBackStack>(EMPTY_STACK);
	/** Mirror so `goBack` reads the live stack without a stale closure. */
	const stackRef = useRef(stack);
	stackRef.current = stack;
	/** Captured between `captureJumpOrigin` and `commitJumpOrigin`. */
	const pendingRef = useRef<JumpOrigin | null>(null);

	// New document (or viewer unmount/remount cycle) invalidates old origins.
	// biome-ignore lint/correctness/useExhaustiveDependencies: docId is the effect trigger, not a value read inside the effect.
	useEffect(() => {
		setStack(EMPTY_STACK);
		pendingRef.current = null;
	}, [docId]);

	const readOrigin = useCallback((): JumpOrigin | null => {
		if (!viewportCap || !scrollCap) return null;
		try {
			// `getCurrentPage` is 1-based, like `scrollToPage({ pageNumber })`.
			const page = scrollCap.forDocument(docId).getCurrentPage();
			if (!Number.isFinite(page) || page < 1) return null;
			const metrics = viewportCap.forDocument(docId).getMetrics();
			return { x: metrics.scrollLeft, y: metrics.scrollTop, page };
		} catch {
			// Viewport metrics may not be available yet; nothing to remember.
			return null;
		}
	}, [viewportCap, scrollCap, docId]);

	const captureJumpOrigin = useCallback(() => {
		pendingRef.current = readOrigin();
	}, [readOrigin]);

	const commitJumpOrigin = useCallback(() => {
		const origin = pendingRef.current;
		pendingRef.current = null;
		if (!origin) return;
		setStack((prev) => pushJumpOrigin(prev, origin));
	}, []);

	const goBack = useCallback(() => {
		// Side-effect-free state update: the scroll lives outside the updater
		// so StrictMode's double-invoked updaters cannot re-scroll.
		const popped = popJumpOrigin(stackRef.current);
		if (!popped) return;
		stackRef.current = popped.stack;
		setStack(popped.stack);
		if (viewportCap) {
			try {
				viewportCap
					.forDocument(docId)
					// Instant: smooth jumps across distant pages feel like slow render.
					.scrollTo({
						x: popped.origin.x,
						y: popped.origin.y,
						behavior: "instant",
					});
			} catch {
				// Ignore transient scroll failures; the origin is popped either way.
			}
		}
	}, [viewportCap, docId]);

	const backTarget = stack.entries[stack.entries.length - 1] ?? null;

	return { backTarget, captureJumpOrigin, commitJumpOrigin, goBack };
}
