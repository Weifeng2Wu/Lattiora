import { useEffect, useRef } from "react";
import { useNativeSelectAllGuard } from "@/hooks/use-native-select-all-guard";
import { resolveShortcutId, type ShortcutId } from "@/lib/shell/shortcuts";

/** One handler per global keyboard shortcut. */
export type ShortcutHandlers = Record<ShortcutId, () => void>;

/**
 * Bind the global keyboard shortcuts once and dispatch each to its handler.
 * Handlers are read from a ref so the listener never needs to re-bind.
 *
 * @param modalOverlayOpen - a modal app overlay/sheet is open (settings, dialogs, palette…).
 *   Gates `whenSettingsOpen` / `whenSettingsClosed` shortcut rules. Docked, non-modal
 *   surfaces such as the Agent ask-user form do not gate shortcuts.
 */
export function useAppShortcuts(
	modalOverlayOpen: boolean,
	handlers: ShortcutHandlers,
): void {
	useNativeSelectAllGuard();

	const modalOverlayOpenRef = useRef(modalOverlayOpen);
	modalOverlayOpenRef.current = modalOverlayOpen;
	const handlersRef = useRef(handlers);
	handlersRef.current = handlers;

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const id = resolveShortcutId(event, {
				settingsOpen: modalOverlayOpenRef.current,
			});
			if (!id) return;
			const target = event.target;
			// The canvas and its portals own scene import, zoom, and element links.
			if (
				target instanceof HTMLElement &&
				target.closest(".excalidraw") &&
				["openVault", "zoomIn", "zoomOut", "zoomReset", "quickChat"].includes(
					id,
				)
			)
				return;

			// Editor-native combos — only claim them outside text fields:
			// ⌘⌫ delete-to-line-start; ⌘← / ⇧⌘← jump/select to line start (macOS);
			// ⌘X / ⌘V should keep native cut/paste while editing text;
			// ⌥A (layoutTranslate) types composed chars (å) inside text fields.
			if (
				id === "deleteTreeItem" ||
				id === "collapseTreeCurrent" ||
				id === "collapseTreeDefault" ||
				id === "cutTreeItem" ||
				id === "pasteTreeItem" ||
				id === "layoutTranslate"
			) {
				const el = event.target;
				if (
					el instanceof HTMLElement &&
					el.closest(
						"input, textarea, select, [contenteditable='true'], [role='textbox'], .excalidraw",
					)
				) {
					return;
				}
			}

			event.preventDefault();
			handlersRef.current[id]();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
