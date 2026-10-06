/**
 * Rail layout controller: owns the resizable panel refs and the
 * imperative collapse / expand transitions, and registers them into the
 * ui-store so plain actions (palette, shortcuts, agent) can drive layout.
 */

import { type RefObject, useEffect, useMemo, useRef } from "react";
import { usePanelRef } from "react-resizable-panels";
import { prefersReducedMotion } from "@/lib/core/motion";
import {
	getShellLayoutPrefs,
	type RailLimits,
	railWidthsForSlot,
	seedBootWidths,
} from "@/lib/shell/layout-persist";
import {
	type LayoutPresetMode,
	layoutModeLeftCollapsed,
	layoutModeRightCollapsed,
	layoutModeRightRatio,
} from "@/lib/shell/layout-presets";
import {
	registerLayoutController,
	setLastAppliedPreset,
	setLayoutMode,
	setRightSidebarOpenState,
	setSidebarCollapsedState,
	uiStore,
} from "@/lib/shell/ui-store";
import { setNotesSplit, toggleNotesSplit } from "@/lib/workspace/actions";
import { getActiveTabId, getTabs } from "@/lib/workspace/store";
import { tabHasNotesSplit, tabNotesEligible } from "@/lib/workspace/tabs";

export const SIDEBAR_DEFAULT_PX = 200;
export const RIGHT_SIDEBAR_DEFAULT_PX = 320;
// Keep in sync with the Panel min/max constraints in App.tsx.
export const SIDEBAR_MIN_PX = 160;
export const SIDEBAR_MAX_RATIO = 0.3;
export const RIGHT_SIDEBAR_MIN_PX = 260;
export const RIGHT_SIDEBAR_MAX_RATIO = 0.5;
/** Collapse detection tolerance (collapsedSize is 0; sub-pixel rounding). */
export const RAIL_COLLAPSED_MAX_PX = 1;

const LEFT_LIMITS: RailLimits = {
	minPx: SIDEBAR_MIN_PX,
	maxRatio: SIDEBAR_MAX_RATIO,
};
const RIGHT_LIMITS: RailLimits = {
	minPx: RIGHT_SIDEBAR_MIN_PX,
	maxRatio: RIGHT_SIDEBAR_MAX_RATIO,
};

export type ShellLayout = {
	sidebarPanelRef: ReturnType<typeof usePanelRef>;
	rightSidebarPanelRef: ReturnType<typeof usePanelRef>;
	sourcePanelRef: ReturnType<typeof usePanelRef>;
	sidebarAsideRef: RefObject<HTMLElement | null>;
	editorPaneRef: RefObject<HTMLDivElement | null>;
	/** Last expanded rail widths in px (survive collapse / PDF immersive round-trips). */
	leftWidthPxRef: RefObject<number>;
	rightWidthPxRef: RefObject<number>;
	/** Restored boot widths (remembered ratios × current window, clamped). */
	initialLeftPx: number;
	initialRightPx: number;
	/** Which rail is running a programmatic collapse/expand transition. */
	animatingRailRef: RefObject<"left" | "right" | "both" | null>;
	cancelRailAnimation: () => void;
};

/** Keep in sync with --motion-duration-normal in index.css. */
const RAIL_ANIMATION_MS = 200;

export function useShellLayout(vaultPath: string | null = null): ShellLayout {
	const sidebarPanelRef = usePanelRef();
	const rightSidebarPanelRef = usePanelRef();
	const sourcePanelRef = usePanelRef();
	const sidebarAsideRef = useRef<HTMLElement>(null);
	const editorPaneRef = useRef<HTMLDivElement>(null);
	// Seed from persisted per-layout ratios so the first paint already matches
	// the remembered arrangement (see lib/shell/layout-persist.ts).
	const bootWidths = useMemo(
		() =>
			seedBootWidths(
				getShellLayoutPrefs(),
				window.innerWidth,
				LEFT_LIMITS,
				RIGHT_LIMITS,
				{ leftPx: SIDEBAR_DEFAULT_PX, rightPx: RIGHT_SIDEBAR_DEFAULT_PX },
			),
		[],
	);
	const leftWidthPxRef = useRef(bootWidths.leftPx);
	const rightWidthPxRef = useRef(bootWidths.rightPx);
	const animatingRailRef = useRef<"left" | "right" | "both" | null>(null);
	const railAnimTimerRef = useRef({ left: 0, right: 0 });

	const controller = useMemo(() => {
		const rememberedWidths = () =>
			railWidthsForSlot(
				getShellLayoutPrefs(),
				uiStore.getState().lastAppliedPreset ?? "custom",
				window.innerWidth,
				LEFT_LIMITS,
				RIGHT_LIMITS,
			);
		const setAnimatingRail = (side: "left" | "right") => {
			const current = animatingRailRef.current;
			animatingRailRef.current = !current || current === side ? side : "both";
		};

		const clearRailAnimating = () => {
			for (const el of document.querySelectorAll("[data-rail-animating]")) {
				el.removeAttribute("data-rail-animating");
			}
		};

		const clearAnimatingRail = (side: "left" | "right") => {
			railAnimTimerRef.current[side] = 0;
			const leftActive = railAnimTimerRef.current.left !== 0;
			const rightActive = railAnimTimerRef.current.right !== 0;
			if (leftActive && rightActive) {
				animatingRailRef.current = "both";
				return;
			}
			if (leftActive) {
				animatingRailRef.current = "left";
				return;
			}
			if (rightActive) {
				animatingRailRef.current = "right";
				return;
			}
			clearRailAnimating();
			animatingRailRef.current = null;
		};

		const cancelRailAnimation = () => {
			for (const side of ["left", "right"] as const) {
				const timer = railAnimTimerRef.current[side];
				if (timer) {
					window.clearTimeout(timer);
					railAnimTimerRef.current[side] = 0;
				}
			}
			clearRailAnimating();
			animatingRailRef.current = null;
		};

		/**
		 * The library sizes panels via flex-grow and snaps resize() between
		 * collapsedSize and minSize, so tweening resize() is impossible.
		 * Instead: mark every panel in the group so `flex-grow` transitions
		 * (see index.css), then let collapse()/expand() commit the final layout
		 * — the browser animates all panels in lockstep. A user drag on a
		 * separator cancels the transition first (see App handles).
		 */
		const withRailAnimation = (
			side: "left" | "right",
			panelEl: HTMLElement | null,
			apply: () => void,
		) => {
			if (prefersReducedMotion() || !panelEl) {
				apply();
				return;
			}
			const currentTimer = railAnimTimerRef.current[side];
			if (currentTimer) window.clearTimeout(currentTimer);
			setAnimatingRail(side);
			const groupEl = panelEl.closest("[data-group]") ?? panelEl.parentElement;
			const targets = groupEl
				? groupEl.querySelectorAll("[data-panel]")
				: [panelEl];
			for (const el of targets) el.setAttribute("data-rail-animating", "");
			apply();
			railAnimTimerRef.current[side] = window.setTimeout(() => {
				clearAnimatingRail(side);
			}, RAIL_ANIMATION_MS + 40);
		};

		/** Collapse / expand left file-tree panel without remounting. */
		const setLeftCollapsed = (collapsed: boolean) => {
			const panel = sidebarPanelRef.current;
			if (panel) {
				const el = document.getElementById("sidebar");
				if (collapsed) {
					withRailAnimation("left", el, () => {
						try {
							panel.collapse();
						} catch {
							// ignore
						}
					});
				} else {
					const targetPx =
						rememberedWidths().leftPx ??
						(leftWidthPxRef.current || SIDEBAR_DEFAULT_PX);
					withRailAnimation("left", el, () => {
						try {
							panel.expand();
							panel.resize(targetPx);
						} catch {
							// ignore
						}
					});
					// expand() fires onResize synchronously and may overwrite the
					// remembered width with the library's default expand size.
					leftWidthPxRef.current = targetPx;
				}
			}
			setSidebarCollapsedState(collapsed);
		};

		/** Collapse / expand right Agent/Backlinks panel (always mounted). */
		const setRightCollapsed = (
			collapsed: boolean,
			_opts?: { focusAgent?: boolean },
		) => {
			const panel = rightSidebarPanelRef.current;
			if (panel) {
				const el = document.getElementById("right-sidebar");
				if (collapsed) {
					withRailAnimation("right", el, () => {
						try {
							panel.collapse();
						} catch {
							// ignore
						}
					});
				} else {
					const targetPx =
						rememberedWidths().rightPx ??
						(rightWidthPxRef.current || RIGHT_SIDEBAR_DEFAULT_PX);
					withRailAnimation("right", el, () => {
						try {
							panel.expand();
							panel.resize(targetPx);
						} catch {
							// ignore
						}
					});
					rightWidthPxRef.current = targetPx;
				}
			}
			setRightSidebarOpenState(!collapsed);
		};

		/** Expand + resize the Agent rail to an absolute pixel width. */
		const setRightPx = (px: number) => {
			const panel = rightSidebarPanelRef.current;
			if (!panel) return;
			const el = document.getElementById("right-sidebar");
			withRailAnimation("right", el, () => {
				try {
					panel.expand();
					panel.resize(px);
				} catch {
					// ignore
				}
			});
			rightWidthPxRef.current = px;
			setRightSidebarOpenState(true);
		};

		/** Resize the Agent rail as a fraction of the source + Agent area. */
		const setRightRatio = (ratio: number) => {
			const panel = rightSidebarPanelRef.current;
			const source = sourcePanelRef.current;
			if (!panel || !source) return;
			const total = source.getSize().inPixels + panel.getSize().inPixels;
			if (total <= 0) return;
			setRightPx(Math.round(total * ratio));
		};

		const applyLayoutMode = (mode: LayoutPresetMode) => {
			// Stop recording custom visibility before programmatic panel changes.
			setLayoutMode(mode);
			setLastAppliedPreset(mode);
			// Prefer the widths remembered for this mode; fall back to the
			// static preset ratios on first use.
			const saved = railWidthsForSlot(
				getShellLayoutPrefs(),
				mode,
				window.innerWidth,
				LEFT_LIMITS,
				RIGHT_LIMITS,
			);
			// Seed the remembered width before collapsing so a later manual
			// reopen (setLeftCollapsed(false) / setRightCollapsed(false))
			// restores this mode's width instead of the static default.
			const leftPx = saved.leftPx ?? SIDEBAR_DEFAULT_PX;
			const rightPx = saved.rightPx ?? RIGHT_SIDEBAR_DEFAULT_PX;
			leftWidthPxRef.current = leftPx;
			setLeftCollapsed(layoutModeLeftCollapsed(mode));

			if (mode === "notes") setNotesSplit(true, { preserveLayoutMode: true });
			else setNotesSplit(false, { preserveLayoutMode: true });

			if (layoutModeRightCollapsed(mode)) {
				setRightCollapsed(true);
				// Collapse can synchronously report the outgoing layout's width.
				rightWidthPxRef.current = rightPx;
			} else if (saved.rightPx !== undefined) {
				setRightPx(saved.rightPx);
			} else {
				setRightRatio(layoutModeRightRatio(mode));
			}
		};

		const focusSidebar = () => {
			// Expanding a collapsed rail deviates from the active preset.
			if (uiStore.getState().sidebarCollapsed) setLayoutMode("custom");
			setLeftCollapsed(false);
			requestAnimationFrame(() => {
				sidebarAsideRef.current?.querySelector<HTMLElement>("button")?.focus();
			});
		};

		const focusEditorPane = () => {
			editorPaneRef.current
				?.querySelector<HTMLElement>("[contenteditable='true']")
				?.focus();
		};

		const focusNotesEditor = () => {
			const tab = getTabs().find((t) => t.id === getActiveTabId());
			if (tab && tabNotesEligible(tab) && !tabHasNotesSplit(getTabs(), tab)) {
				toggleNotesSplit();
			}
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					// Prefer a NOTES secondary-pane editor when present.
					const root = editorPaneRef.current;
					if (!root) return;
					const editables = root.querySelectorAll<HTMLElement>(
						"[contenteditable='true']",
					);
					const target = editables[editables.length - 1] ?? editables[0];
					target?.focus();
				});
			});
		};

		return {
			setLeftCollapsed,
			setRightCollapsed,
			applyLayoutMode,
			focusSidebar,
			focusEditorPane,
			focusNotesEditor,
			cancelRailAnimation,
		};
	}, [sidebarPanelRef, rightSidebarPanelRef, sourcePanelRef]);

	useEffect(() => {
		registerLayoutController(controller);
		return () => {
			registerLayoutController(null);
			controller.cancelRailAnimation();
		};
	}, [controller]);

	useEffect(() => {
		if (!vaultPath) return;
		// The left panel is conditional on the Vault. Its initial default and
		// the panel library's cached layout can predate the latest user resize.
		// Wait for panel registration, then restore from the current width slot.
		const frame = requestAnimationFrame(() => {
			const panel = sidebarPanelRef.current;
			if (!panel) return;
			const state = uiStore.getState();
			const saved = railWidthsForSlot(
				getShellLayoutPrefs(),
				state.lastAppliedPreset ?? "custom",
				window.innerWidth,
				LEFT_LIMITS,
				RIGHT_LIMITS,
			);
			const width = saved.leftPx ?? leftWidthPxRef.current;
			if (state.sidebarCollapsed) panel.collapse();
			else panel.resize(width);
			leftWidthPxRef.current = width;
		});
		return () => cancelAnimationFrame(frame);
	}, [vaultPath, sidebarPanelRef]);

	return {
		sidebarPanelRef,
		rightSidebarPanelRef,
		sourcePanelRef,
		sidebarAsideRef,
		editorPaneRef,
		leftWidthPxRef,
		rightWidthPxRef,
		initialLeftPx: bootWidths.leftPx,
		initialRightPx: bootWidths.rightPx,
		animatingRailRef,
		cancelRailAnimation: controller.cancelRailAnimation,
	};
}
