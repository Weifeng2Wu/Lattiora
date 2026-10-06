import { describe, expect, it } from "vitest";
import {
	commitShellRailWidths,
	normalizeShellLayoutPrefs,
	RAIL_RECORD_MIN_PX,
	type RailLimits,
	railPxFromRatio,
	railWidthsForSlot,
	SHELL_LAYOUT_STORAGE_KEY,
	saveCustomRails,
	saveLastMode,
	seedBootWidths,
} from "@/lib/shell/layout-persist";

const LEFT: RailLimits = { minPx: 160, maxRatio: 0.3 };
const RIGHT: RailLimits = { minPx: 260, maxRatio: 0.5 };

/** Map-backed StorageLike seeded with the given prefs payload under the key. */
function makeStorage(initialPrefs?: unknown) {
	const map = new Map<string, string>(
		initialPrefs === undefined
			? []
			: [[SHELL_LAYOUT_STORAGE_KEY, JSON.stringify(initialPrefs)]],
	);
	const storage = {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => {
			map.set(key, value);
		},
		removeItem: (key: string) => {
			map.delete(key);
		},
	};
	return { storage, read: () => map.get(SHELL_LAYOUT_STORAGE_KEY) };
}

describe("normalizeShellLayoutPrefs", () => {
	it("passes a valid payload through", () => {
		const prefs = normalizeShellLayoutPrefs({
			lastMode: "agent",
			widths: { agent: { left: 0.2, right: 0.35 }, custom: { left: 0.25 } },
			customRails: { leftCollapsed: true, rightOpen: false },
		});
		expect(prefs).toEqual({
			lastMode: "agent",
			widths: { agent: { left: 0.2, right: 0.35 }, custom: { left: 0.25 } },
			customRails: { leftCollapsed: true, rightOpen: false },
		});
	});

	it("falls back to an empty custom layout on corrupt roots", () => {
		for (const raw of [null, "x", 42, []]) {
			expect(normalizeShellLayoutPrefs(raw)).toEqual({
				lastMode: "custom",
				widths: {},
			});
		}
	});

	it("drops out-of-bounds and non-finite ratios", () => {
		const prefs = normalizeShellLayoutPrefs({
			widths: {
				agent: { left: 0.01, right: 0.61 },
				notes: { left: Number.NaN, right: Number.POSITIVE_INFINITY },
				reading: { left: "0.2", right: 0.3 },
			},
		});
		expect(prefs.widths.agent).toBeUndefined();
		expect(prefs.widths.notes).toBeUndefined();
		expect(prefs.widths.reading).toEqual({ right: 0.3 });
	});

	it("drops unknown slots and empty entries", () => {
		const prefs = normalizeShellLayoutPrefs({
			lastMode: "bogus",
			widths: { bogus: { left: 0.2 }, notes: {} },
		});
		expect(prefs.lastMode).toBe("custom");
		expect(prefs.widths).toEqual({});
	});

	it("rounds ratios to three decimals", () => {
		const prefs = normalizeShellLayoutPrefs({
			widths: { agent: { left: 0.20123456 } },
		});
		expect(prefs.widths.agent?.left).toBe(0.201);
	});

	it("keeps customRails only when both booleans are present", () => {
		expect(
			normalizeShellLayoutPrefs({ customRails: { leftCollapsed: true } })
				.customRails,
		).toBeUndefined();
		expect(
			normalizeShellLayoutPrefs({
				customRails: { leftCollapsed: false, rightOpen: "yes" },
			}).customRails,
		).toBeUndefined();
	});
});

describe("railPxFromRatio", () => {
	it("clamps into the panel limits", () => {
		expect(railPxFromRatio(0.1, 1000, LEFT)).toBe(160);
		expect(railPxFromRatio(0.5, 1000, LEFT)).toBe(300);
		expect(railPxFromRatio(0.5, 1000, RIGHT)).toBe(500);
		expect(railPxFromRatio(0.9, 1000, RIGHT)).toBe(500);
	});

	it("rounds and returns null for missing ratios or degenerate windows", () => {
		expect(railPxFromRatio(undefined, 1000, LEFT)).toBeNull();
		expect(railPxFromRatio(0.2, 500, RIGHT)).toBeNull(); // maxPx 250 < minPx 260
		expect(railPxFromRatio(0.251, 1000, LEFT)).toBe(251);
	});
});

describe("railWidthsForSlot / seedBootWidths", () => {
	it("restores the slot's remembered widths clamped to the viewport", () => {
		const prefs = normalizeShellLayoutPrefs({
			widths: { agent: { left: 0.25, right: 0.4 } },
		});
		expect(railWidthsForSlot(prefs, "agent", 1000, LEFT, RIGHT)).toEqual({
			leftPx: 250,
			rightPx: 400,
		});
		// Narrow window: the ratio re-derives smaller pixel widths that stay
		// within the panel limits (left 0.25×700=175, right 0.4×700=280).
		expect(railWidthsForSlot(prefs, "agent", 700, LEFT, RIGHT)).toEqual({
			leftPx: 175,
			rightPx: 280,
		});
	});

	it("prefers the restored mode slot, then custom, then defaults", () => {
		const prefs = normalizeShellLayoutPrefs({
			lastMode: "agent",
			widths: {
				agent: { right: 0.4 },
				custom: { left: 0.25, right: 0.3 },
			},
		});
		expect(
			seedBootWidths(prefs, 1000, LEFT, RIGHT, {
				leftPx: 200,
				rightPx: 320,
			}),
		).toEqual({ leftPx: 250, rightPx: 400 });
	});

	it("falls back to defaults when nothing is remembered", () => {
		expect(
			seedBootWidths(normalizeShellLayoutPrefs(null), 1000, LEFT, RIGHT, {
				leftPx: 200,
				rightPx: 320,
			}),
		).toEqual({ leftPx: 200, rightPx: 320 });
	});
});

describe("commitShellRailWidths", () => {
	it("writes user-resized widths into the given slot only", () => {
		const { storage, read } = makeStorage();
		commitShellRailWidths(
			{ leftRatio: 0.2, rightRatio: 0.35 },
			"agent",
			1000,
			storage,
		);
		expect(JSON.parse(read() ?? "{}")).toEqual({
			lastMode: "custom",
			widths: { agent: { left: 0.2, right: 0.35 } },
		});
	});

	it("skips sides dragged below the recording threshold", () => {
		const { storage, read } = makeStorage({
			lastMode: "agent",
			widths: { agent: { left: 0.2, right: 0.35 } },
		});
		// Right rail dragged shut (< 80px) must keep its remembered width.
		commitShellRailWidths(
			{ leftRatio: 0.25, rightRatio: 0.05 },
			"agent",
			1000,
			storage,
		);
		expect(JSON.parse(read() ?? "{}").widths.agent).toEqual({
			left: 0.25,
			right: 0.35,
		});
	});

	it("does not rewrite storage when nothing changed", () => {
		const initialPrefs = {
			lastMode: "agent",
			widths: { agent: { left: 0.2 } },
		};
		const { storage, read } = makeStorage(initialPrefs);
		commitShellRailWidths({ leftRatio: 0.2 }, "agent", 1000, storage);
		expect(read()).toBe(JSON.stringify(initialPrefs));
	});

	it("records at the 80px boundary", () => {
		const { storage, read } = makeStorage();
		commitShellRailWidths(
			{ leftRatio: RAIL_RECORD_MIN_PX / 1000 },
			"notes",
			1000,
			storage,
		);
		expect(JSON.parse(read() ?? "{}").widths.notes?.left).toBe(0.08);
	});
});

describe("saveLastMode / saveCustomRails", () => {
	it("mirror mode and custom rail state into storage", () => {
		const { storage, read } = makeStorage();
		saveLastMode("notes", storage);
		saveCustomRails({ leftCollapsed: false, rightOpen: true }, storage);
		expect(JSON.parse(read() ?? "{}")).toEqual({
			lastMode: "notes",
			widths: {},
			customRails: { leftCollapsed: false, rightOpen: true },
		});
	});

	it("skip redundant writes", () => {
		const initialPrefs = {
			lastMode: "reading",
			widths: {},
			customRails: { leftCollapsed: true, rightOpen: false },
		};
		const { storage, read } = makeStorage(initialPrefs);
		saveLastMode("reading", storage);
		saveCustomRails({ leftCollapsed: true, rightOpen: false }, storage);
		expect(read()).toBe(JSON.stringify(initialPrefs));
	});
});
