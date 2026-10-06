/**
 * Persisted shell rail widths (localStorage, best-effort).
 *
 * Widths are stored as fractions of the window width, one entry per layout
 * mode, so a remembered drag survives both preset round-trips and app
 * restarts on a differently sized window. Follows the hand-rolled persist
 * modules (workspace tabs, paper info height): strict normalize on read,
 * silent best-effort writes, no store middleware.
 */

import {
	readJsonStorage,
	type StorageLike,
	writeJsonStorage,
} from "@/lib/core/storage";
import type { LayoutPresetMode } from "@/lib/shell/layout-presets";

export const SHELL_LAYOUT_STORAGE_KEY = "agentero.shellLayout.v1";

/** Rail width as a fraction of the window width (0.02–0.6, 3 decimals). */
export type RailWidthPrefs = {
	left?: number;
	right?: number;
};
export type LayoutWidthSlot = LayoutPresetMode | "custom";
/** Rail open/closed snapshot — only meaningful for the free-form custom mode. */
export type CustomRailsState = {
	leftCollapsed: boolean;
	rightOpen: boolean;
};
export type ShellLayoutPrefs = {
	lastMode: LayoutWidthSlot;
	/** Width owner survives manual changes (which switch lastMode to custom). */
	lastPreset?: LayoutPresetMode;
	widths: Partial<Record<LayoutWidthSlot, RailWidthPrefs>>;
	customRails?: CustomRailsState;
};

/** Sanity bounds for stored ratios (live panel caps are 30% / 50%). */
export const RAIL_RATIO_MIN = 0.02;
export const RAIL_RATIO_MAX = 0.6;
/** Matches the collapse-vs-resize recording threshold in App's onResize. */
export const RAIL_RECORD_MIN_PX = 80;

const SLOTS: readonly LayoutWidthSlot[] = [
	"agent",
	"notes",
	"reading",
	"custom",
];

export type RailLimits = {
	minPx: number;
	maxRatio: number;
};

export function normalizeRailRatio(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	if (value < RAIL_RATIO_MIN || value > RAIL_RATIO_MAX) return null;
	return Math.round(value * 1000) / 1000;
}

/** Self-heal any stored payload; never throws, unknown fields are dropped. */
export function normalizeShellLayoutPrefs(raw: unknown): ShellLayoutPrefs {
	const fallback: ShellLayoutPrefs = { lastMode: "custom", widths: {} };
	if (typeof raw !== "object" || raw === null) return fallback;
	const rec = raw as Record<string, unknown>;
	const lastMode = SLOTS.includes(rec.lastMode as LayoutWidthSlot)
		? (rec.lastMode as LayoutWidthSlot)
		: "custom";
	const widths: Partial<Record<LayoutWidthSlot, RailWidthPrefs>> = {};
	if (typeof rec.widths === "object" && rec.widths !== null) {
		for (const slot of SLOTS) {
			const entry = (rec.widths as Record<string, unknown>)[slot];
			if (typeof entry !== "object" || entry === null) continue;
			const next: RailWidthPrefs = {};
			const left = normalizeRailRatio((entry as Record<string, unknown>).left);
			if (left !== null) next.left = left;
			const right = normalizeRailRatio(
				(entry as Record<string, unknown>).right,
			);
			if (right !== null) next.right = right;
			if (next.left !== undefined || next.right !== undefined)
				widths[slot] = next;
		}
	}
	const prefs: ShellLayoutPrefs = { lastMode, widths };
	if (
		rec.lastPreset === "agent" ||
		rec.lastPreset === "notes" ||
		rec.lastPreset === "reading"
	) {
		prefs.lastPreset = rec.lastPreset;
	}
	if (typeof rec.customRails === "object" && rec.customRails !== null) {
		const rails = rec.customRails as Record<string, unknown>;
		if (
			typeof rails.leftCollapsed === "boolean" &&
			typeof rails.rightOpen === "boolean"
		) {
			prefs.customRails = {
				leftCollapsed: rails.leftCollapsed,
				rightOpen: rails.rightOpen,
			};
		}
	}
	return prefs;
}

/** Ratio → px against the current viewport, clamped into the panel's limits. */
export function railPxFromRatio(
	ratio: number | undefined,
	viewportPx: number,
	limits: RailLimits,
): number | null {
	if (ratio === undefined) return null;
	const maxPx = Math.round(viewportPx * limits.maxRatio);
	if (maxPx < limits.minPx) return null; // degenerate narrow window
	return Math.round(
		Math.min(Math.max(ratio * viewportPx, limits.minPx), maxPx),
	);
}

/** Restored px widths for one layout slot (undefined side = not remembered). */
export function railWidthsForSlot(
	prefs: ShellLayoutPrefs,
	slot: LayoutWidthSlot,
	viewportPx: number,
	left: RailLimits,
	right: RailLimits,
): { leftPx?: number; rightPx?: number } {
	const entry = prefs.widths[slot];
	const out: { leftPx?: number; rightPx?: number } = {};
	const leftPx = railPxFromRatio(entry?.left, viewportPx, left);
	if (leftPx !== null) out.leftPx = leftPx;
	const rightPx = railPxFromRatio(entry?.right, viewportPx, right);
	if (rightPx !== null) out.rightPx = rightPx;
	return out;
}

/**
 * Boot seeding: prefer the restored mode's slot, then the custom slot (the
 * closest thing to a general width preference), then the static defaults.
 */
export function seedBootWidths(
	prefs: ShellLayoutPrefs,
	viewportPx: number,
	left: RailLimits,
	right: RailLimits,
	defaults: { leftPx: number; rightPx: number },
): { leftPx: number; rightPx: number } {
	const primary = railWidthsForSlot(
		prefs,
		prefs.lastMode === "custom"
			? (prefs.lastPreset ?? "custom")
			: prefs.lastMode,
		viewportPx,
		left,
		right,
	);
	const secondary =
		prefs.lastMode === "custom"
			? {}
			: railWidthsForSlot(prefs, "custom", viewportPx, left, right);
	return {
		leftPx: primary.leftPx ?? secondary.leftPx ?? defaults.leftPx,
		rightPx: primary.rightPx ?? secondary.rightPx ?? defaults.rightPx,
	};
}

let cache: ShellLayoutPrefs | null = null;

/** Read + normalize; the default-storage read also refreshes the module cache. */
export function loadShellLayoutPrefs(
	storage?: StorageLike | null,
): ShellLayoutPrefs {
	const prefs = normalizeShellLayoutPrefs(
		readJsonStorage(SHELL_LAYOUT_STORAGE_KEY, null, storage),
	);
	if (storage === undefined) cache = prefs;
	return prefs;
}

export function getShellLayoutPrefs(): ShellLayoutPrefs {
	return cache ?? loadShellLayoutPrefs();
}

function persist(prefs: ShellLayoutPrefs, storage?: StorageLike | null): void {
	if (storage === undefined) cache = prefs;
	writeJsonStorage(SHELL_LAYOUT_STORAGE_KEY, prefs, storage);
}

function currentPrefs(storage?: StorageLike | null): ShellLayoutPrefs {
	return storage === undefined
		? getShellLayoutPrefs()
		: loadShellLayoutPrefs(storage);
}

/**
 * Record a completed user resize. Sides whose px equivalent collapsed below
 * RAIL_RECORD_MIN_PX keep the previously remembered width (dragging a rail
 * shut must not poison it); ratios outside sanity bounds are dropped.
 */
export function commitShellRailWidths(
	widths: { leftRatio?: number; rightRatio?: number },
	slot: LayoutWidthSlot,
	viewportPx: number,
	storage?: StorageLike | null,
): void {
	const prefs = currentPrefs(storage);
	const entry: RailWidthPrefs = { ...prefs.widths[slot] };
	let changed = false;
	if (
		widths.leftRatio !== undefined &&
		widths.leftRatio * viewportPx >= RAIL_RECORD_MIN_PX
	) {
		const next = normalizeRailRatio(widths.leftRatio);
		if (next !== null && next !== entry.left) {
			entry.left = next;
			changed = true;
		}
	}
	if (
		widths.rightRatio !== undefined &&
		widths.rightRatio * viewportPx >= RAIL_RECORD_MIN_PX
	) {
		const next = normalizeRailRatio(widths.rightRatio);
		if (next !== null && next !== entry.right) {
			entry.right = next;
			changed = true;
		}
	}
	if (!changed) return;
	prefs.widths[slot] = entry;
	persist(prefs, storage);
}

/** Mirror the live layout mode so the next boot restores it. */
export function saveLastMode(
	mode: LayoutWidthSlot,
	storage?: StorageLike | null,
): void {
	const prefs = currentPrefs(storage);
	if (prefs.lastMode === mode) return;
	prefs.lastMode = mode;
	persist(prefs, storage);
}

export function saveLastPreset(mode: LayoutPresetMode): void {
	const prefs = getShellLayoutPrefs();
	if (prefs.lastPreset === mode) return;
	prefs.lastPreset = mode;
	persist(prefs);
}

/** Snapshot the free-form arrangement (custom mode only). */
export function saveCustomRails(
	state: CustomRailsState,
	storage?: StorageLike | null,
): void {
	const prefs = currentPrefs(storage);
	const prev = prefs.customRails;
	if (
		prev &&
		prev.leftCollapsed === state.leftCollapsed &&
		prev.rightOpen === state.rightOpen
	) {
		return;
	}
	prefs.customRails = state;
	persist(prefs, storage);
}
