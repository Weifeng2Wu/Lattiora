import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/core/tauri", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/core/tauri")>();
	return {
		...actual,
		getPlatformOS: vi.fn(() => "macos"),
	};
});

import { getPlatformOS } from "@/lib/core/tauri";
import { formatShortcut, resolveShortcutId } from "@/lib/shell/shortcuts";

function keyEvent(init: {
	key: string;
	metaKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
}): KeyboardEvent {
	return {
		key: init.key,
		metaKey: init.metaKey ?? false,
		ctrlKey: init.ctrlKey ?? false,
		altKey: init.altKey ?? false,
		shiftKey: init.shiftKey ?? false,
	} as KeyboardEvent;
}

describe("shell shortcuts", () => {
	afterEach(() => {
		vi.mocked(getPlatformOS).mockReturnValue("macos");
	});

	it("resolves Obsidian-style split pane shortcut", () => {
		expect(
			resolveShortcutId(keyEvent({ key: "\\", metaKey: true }), {
				settingsOpen: false,
			}),
		).toBe("splitPane");
		expect(
			resolveShortcutId(keyEvent({ key: "\\", ctrlKey: true }), {
				settingsOpen: false,
			}),
		).toBe("splitPane");
	});

	it("renders the split pane chord", () => {
		expect(formatShortcut({ key: "\\", meta: true })).toContain("\\");
	});

	it("separates reopen tab from the terminal chord", () => {
		expect(
			resolveShortcutId(keyEvent({ key: "t", metaKey: true, shiftKey: true }), {
				settingsOpen: false,
			}),
		).toBe("reopenTab");
		expect(
			resolveShortcutId(keyEvent({ key: "t", metaKey: true, altKey: true }), {
				settingsOpen: false,
			}),
		).toBe("openInTerminal");
	});

	it("binds ⌘K to quick chat and ⇧⌘A to add-to-chat", () => {
		expect(
			resolveShortcutId(keyEvent({ key: "k", metaKey: true }), {
				settingsOpen: false,
			}),
		).toBe("quickChat");
		expect(
			resolveShortcutId(keyEvent({ key: "a", metaKey: true, shiftKey: true }), {
				settingsOpen: false,
			}),
		).toBe("addSelectionToChat");
		expect(
			resolveShortcutId(keyEvent({ key: "a", metaKey: true }), {
				settingsOpen: false,
			}),
		).toBeNull();
	});

	it("leaves ⌘P as quick open", () => {
		expect(
			resolveShortcutId(keyEvent({ key: "p", metaKey: true }), {
				settingsOpen: false,
			}),
		).toBe("quickOpen");
	});

	it("binds ⌘L to toggleChat (add selection when any)", () => {
		expect(
			resolveShortcutId(keyEvent({ key: "l", metaKey: true }), {
				settingsOpen: false,
			}),
		).toBe("toggleChat");
	});

	it("binds F11 to borderless fullscreen only on Windows", () => {
		vi.mocked(getPlatformOS).mockReturnValue("windows");
		expect(
			resolveShortcutId(keyEvent({ key: "F11" }), { settingsOpen: false }),
		).toBe("toggleFullscreen");

		vi.mocked(getPlatformOS).mockReturnValue("macos");
		expect(
			resolveShortcutId(keyEvent({ key: "F11" }), { settingsOpen: false }),
		).toBeNull();
	});
});
