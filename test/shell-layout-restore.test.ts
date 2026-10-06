import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useShellLayout } from "@/hooks/use-shell-layout";
import {
	commitShellRailWidths,
	getShellLayoutPrefs,
	loadShellLayoutPrefs,
	SHELL_LAYOUT_STORAGE_KEY,
} from "@/lib/shell/layout-persist";
import {
	initShellLayoutFromPrefs,
	layout,
	setLayoutMode,
	setRightSidebarOpenState,
	setSidebarCollapsedState,
	uiStore,
} from "@/lib/shell/ui-store";

// Exercise the real controller and persistence without mounting desktop UI.
vi.mock("react", () => ({
	useRef: (current: unknown) => ({ current }),
	useMemo: (factory: () => unknown) => factory(),
	useEffect: (effect: () => unknown) => {
		effect();
	},
}));
vi.mock("react-resizable-panels", () => ({
	usePanelRef: () => ({ current: null }),
}));
vi.mock("@/lib/workspace/actions", () => ({
	setNotesSplit: vi.fn(),
	toggleNotesSplit: vi.fn(),
}));
vi.mock("@/lib/workspace/store", () => ({
	getActiveTabId: () => null,
	getTabs: () => [],
}));

function mountController(vaultPath: string | null = null) {
	// biome-ignore lint/correctness/useHookAtTopLevel: React hooks are mocked to exercise the registered controller in Node.
	const shell = useShellLayout(vaultPath);
	const widths = { left: shell.initialLeftPx, right: shell.initialRightPx };
	for (const side of ["left", "right"] as const) {
		const ref =
			side === "left" ? shell.sidebarPanelRef : shell.rightSidebarPanelRef;
		const remembered =
			side === "left" ? shell.leftWidthPxRef : shell.rightWidthPxRef;
		const report = () => {
			if (widths[side] >= 80) remembered.current = widths[side];
			if (side === "left") setSidebarCollapsedState(widths[side] === 0);
			else setRightSidebarOpenState(widths[side] > 0);
		};
		ref.current = {
			collapse: () => {
				widths[side] = 0;
				report();
			},
			expand: () => {
				widths[side] = 260;
				report();
			},
			resize: (size) => {
				widths[side] = Number(size);
				report();
			},
			getSize: () => ({
				inPixels: widths[side],
				asPercentage: widths[side] / 12,
			}),
			isCollapsed: () => widths[side] === 0,
		};
	}
	const rightPanel = shell.rightSidebarPanelRef.current;
	if (!rightPanel) throw new Error("Missing test panel");
	shell.sourcePanelRef.current = {
		...rightPanel,
		getSize: () => ({
			inPixels: 1200 - widths.left - widths.right,
			asPercentage: 0,
		}),
	};
	const controller = layout();
	if (!controller) throw new Error("Layout controller was not registered");
	return { shell, widths, controller };
}

beforeEach(() => {
	const data = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => data.set(key, value),
	});
	vi.stubGlobal("window", {
		innerWidth: 1200,
		matchMedia: () => ({ matches: true }),
	});
	vi.stubGlobal("document", { getElementById: () => null });
	loadShellLayoutPrefs();
	initShellLayoutFromPrefs();
});
afterEach(() => vi.unstubAllGlobals());

describe("shell layout restoration", () => {
	it("keeps the width owner when customizing a preset restored from older prefs", () => {
		localStorage.setItem(
			SHELL_LAYOUT_STORAGE_KEY,
			JSON.stringify({
				lastMode: "agent",
				widths: { agent: { left: 0.2, right: 0.3 } },
			}),
		);
		loadShellLayoutPrefs();
		initShellLayoutFromPrefs();
		setLayoutMode("custom");
		loadShellLayoutPrefs();
		initShellLayoutFromPrefs();
		expect(uiStore.getState().lastAppliedPreset).toBe("agent");
		expect(mountController().widths).toEqual({ left: 240, right: 360 });
	});

	it("reapplies the latest saved left width after Vault panel registration", () => {
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
			frames.push(callback),
		);
		const { widths, shell } = mountController("/vault");
		expect(shell.initialLeftPx).toBe(200);
		commitShellRailWidths({ leftRatio: 0.24 }, "custom", 1200);
		// Registration may restore an old library layout; the explicit restore
		// must read the latest preference rather than the boot default.
		widths.left = 200;
		frames[0](0);
		expect(widths.left).toBe(288);
		expect(shell.leftWidthPxRef.current).toBe(288);
	});

	it("keeps a remembered left rail collapsed when a Vault opens", () => {
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
			frames.push(callback),
		);
		commitShellRailWidths({ leftRatio: 0.24 }, "custom", 1200);
		const { widths, shell } = mountController("/vault");
		setSidebarCollapsedState(true);
		frames[0](0);
		expect(widths.left).toBe(0);
		expect(shell.leftWidthPxRef.current).toBe(288);
	});
	it("restores both notes rails after Agent round-trips, including reopening", () => {
		const { controller, widths } = mountController();
		controller.applyLayoutMode("notes");
		setLayoutMode("custom");
		controller.setLeftCollapsed(false);
		controller.setRightCollapsed(false);
		commitShellRailWidths({ leftRatio: 0.2, rightRatio: 0.3 }, "notes", 1200);
		controller.applyLayoutMode("agent");
		commitShellRailWidths({ leftRatio: 0.25, rightRatio: 0.4 }, "agent", 1200);
		controller.applyLayoutMode("notes");
		expect(widths).toEqual({ left: 0, right: 0 });
		controller.setLeftCollapsed(false);
		controller.setRightCollapsed(false);
		expect(widths).toEqual({ left: 240, right: 360 });
		controller.applyLayoutMode("agent");
		expect(widths).toEqual({ left: 300, right: 480 });
	});

	it("uses sidebar defaults for an unvisited layout instead of the outgoing widths", () => {
		commitShellRailWidths({ leftRatio: 0.25, rightRatio: 0.4 }, "agent", 1200);
		const { controller, widths } = mountController();
		controller.applyLayoutMode("agent");
		controller.applyLayoutMode("reading");
		controller.setLeftCollapsed(false);
		controller.setRightCollapsed(false);
		expect(widths).toEqual({ left: 200, right: 320 });
	});

	it("restores custom visibility and its preset width owner after a cold reload", () => {
		const { controller } = mountController();
		controller.applyLayoutMode("notes");
		setLayoutMode("custom");
		controller.setLeftCollapsed(false);
		controller.setRightCollapsed(false);
		commitShellRailWidths({ leftRatio: 0.2, rightRatio: 0.3 }, "notes", 1200);
		// Re-read persisted JSON, with a new store state and different window width.
		loadShellLayoutPrefs();
		uiStore.setState({
			lastAppliedPreset: null,
			sidebarCollapsed: true,
			rightSidebarOpen: false,
		});
		initShellLayoutFromPrefs();
		window.innerWidth = 1500;
		const restored = useShellLayout();
		expect(restored.initialLeftPx).toBe(300);
		expect(restored.initialRightPx).toBe(450);
		expect(uiStore.getState()).toMatchObject({
			layoutMode: "custom",
			lastAppliedPreset: "notes",
			sidebarCollapsed: false,
			rightSidebarOpen: true,
		});
		commitShellRailWidths(
			{ rightRatio: 0.32 },
			uiStore.getState().lastAppliedPreset ?? "custom",
			1500,
		);
		expect(getShellLayoutPrefs().widths.notes?.right).toBe(0.32);
	});

	it("snapshots both rail flags when entering custom without a visibility change", () => {
		mountController().controller.applyLayoutMode("agent");
		setLayoutMode("custom");
		expect(getShellLayoutPrefs().customRails).toEqual({
			leftCollapsed: false,
			rightOpen: true,
		});
	});

	it("reopens collapsed rails at the saved ratios after a window resize", () => {
		const { controller, widths, shell } = mountController();
		controller.applyLayoutMode("notes");
		commitShellRailWidths({ leftRatio: 0.2, rightRatio: 0.3 }, "notes", 1200);
		window.innerWidth = 1500;
		// A programmatic resize echo must not win over the user's saved widths.
		shell.leftWidthPxRef.current = 170;
		shell.rightWidthPxRef.current = 270;
		controller.setLeftCollapsed(false);
		controller.setRightCollapsed(false);
		expect(widths).toEqual({ left: 300, right: 450 });
	});
});
