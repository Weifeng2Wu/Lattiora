/**
 * App shortcuts aligned with common macOS / Apple HIG patterns.
 * Display uses Apple symbols: ⌘ ⌥ ⇧ ⌃
 */

import { getPlatformOS } from "@/lib/core/tauri";

export type ShortcutId =
	| "settings"
	| "newWindow"
	| "openVault"
	| "createVault"
	| "refreshTree"
	| "revealInFinder"
	| "openInTerminal"
	| "deleteTreeItem"
	| "cutTreeItem"
	| "pasteTreeItem"
	/** ⌘← — collapse selected file-tree folder (or its parent) */
	| "collapseTreeCurrent"
	/** ⇧⌘← — reset tree to only papers/ expanded (children listed, not open) */
	| "collapseTreeDefault"
	| "magicWand"
	/** ⌘P — quick open papers & contents */
	| "quickOpen"
	/** ⇧⌘P — run app commands */
	| "commandPalette"
	| "toggleSidebar"
	| "toggleChat"
	/** ⌘K — in-page Quick chat (Ask) from the live selection */
	| "quickChat"
	/** ⇧⌘A — pin the live selection into the Agent context and focus the composer */
	| "addSelectionToChat"
	| "closeSheet"
	| "focusSidebar"
	| "focusEditor"
	| "focusNotes"
	| "closeTab"
	/** ⇧⌘T — reopen the most recently closed tab */
	| "reopenTab"
	| "splitPane"
	| "nextTab"
	| "prevTab"
	| "zoomIn"
	| "zoomOut"
	| "zoomReset"
	/** ⌘. — start/cancel PDF visual-region annotation (active PDF tab). */
	| "visualAnnotation"
	/** ⌥A — toggle PDF full-text (layout) translation (active PDF tab). */
	| "layoutTranslate"
	/** F11 — borderless fullscreen (Windows only). */
	| "toggleFullscreen";

export type ShortcutGroup = "App" | "Navigation" | "Vault";

export type ShortcutPlatform = "windows" | "macos" | "linux";

export type ShortcutDef = {
	id: ShortcutId;
	/** Grouping label (translated for display via the `shortcuts` namespace) */
	group: ShortcutGroup;
	/** Keys without modifiers, lower-case letter or special */
	key: string;
	meta?: boolean;
	ctrl?: boolean;
	alt?: boolean;
	shift?: boolean;
	/**
	 * When true, only matches if any app overlay is open
	 * (settings, dialogs, command palette — see overlay-stack).
	 */
	whenSettingsOpen?: boolean;
	/** When true, only matches if no app overlay is open. */
	whenSettingsClosed?: boolean;
	/** When set, only active / listed on these desktop OSes. */
	platforms?: readonly ShortcutPlatform[];
};

export const SHORTCUTS: ShortcutDef[] = [
	{
		id: "settings",
		group: "App",
		key: ",",
		meta: true,
	},
	{
		id: "closeSheet",
		group: "App",
		// Esc — dismiss the topmost registered overlay (settings, dialogs, palette…)
		key: "Escape",
		whenSettingsOpen: true,
	},
	{
		id: "zoomIn",
		group: "App",
		// ⌘+ — zoom whole UI in (matches browsers / VS Code)
		key: "+",
		meta: true,
		shift: true,
		whenSettingsClosed: true,
	},
	{
		id: "zoomOut",
		group: "App",
		// ⌘- — zoom whole UI out
		key: "-",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "zoomReset",
		group: "App",
		// ⌘0 — reset UI zoom to 100%
		key: "0",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "newWindow",
		group: "App",
		key: "n",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "openVault",
		group: "Vault",
		key: "o",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "createVault",
		group: "Vault",
		key: "n",
		meta: true,
		shift: true,
		whenSettingsClosed: true,
	},
	{
		id: "refreshTree",
		group: "Vault",
		key: "r",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "revealInFinder",
		group: "Vault",
		// ⌥⌘R — reveal selected tree item in Finder / Explorer
		key: "r",
		meta: true,
		alt: true,
		whenSettingsClosed: true,
	},
	{
		id: "openInTerminal",
		group: "Vault",
		// ⌥⌘T — open system terminal at selected path (dir = self, file = parent)
		key: "t",
		meta: true,
		alt: true,
		whenSettingsClosed: true,
	},
	{
		id: "deleteTreeItem",
		group: "Vault",
		// ⌘⌫ — delete selected file tree item (with confirm)
		key: "Backspace",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "cutTreeItem",
		group: "Vault",
		// ⌘X — cut selected file tree item(s)
		key: "x",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "pasteTreeItem",
		group: "Vault",
		// ⌘V — paste cut file tree item(s) into selected destination
		key: "v",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "collapseTreeCurrent",
		group: "Vault",
		// ⌘← — collapse selected folder (VS Code list.collapse-ish; free of ⌥⌘← tabs)
		key: "ArrowLeft",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "collapseTreeDefault",
		group: "Vault",
		// ⇧⌘← — collapse tree to default (only papers/ open; no subfolder expand)
		key: "ArrowLeft",
		meta: true,
		shift: true,
		whenSettingsClosed: true,
	},
	{
		id: "magicWand",
		group: "Vault",
		// ⇧⌘I — open identifier / magic-wand import popover
		key: "i",
		meta: true,
		shift: true,
		whenSettingsClosed: true,
	},
	{
		id: "quickOpen",
		group: "Navigation",
		// ⌘P — quick open papers + contents (VS Code Go to File)
		key: "p",
		meta: true,
		// No whenSettingsClosed: same key dismisses while palette is open.
	},
	{
		id: "commandPalette",
		group: "Navigation",
		// ⇧⌘P — run app commands (VS Code Command Palette)
		key: "p",
		meta: true,
		shift: true,
		// No whenSettingsClosed: same key dismisses while palette is open.
	},
	{
		id: "toggleSidebar",
		group: "Navigation",
		// Apple Mail / Preview family uses ⌥⌘S; many Mac productivity apps use ⌘B.
		// Prefer ⌥⌘S for platform feel; ⌘B kept as secondary alias in matcher.
		key: "s",
		meta: true,
		alt: true,
		whenSettingsClosed: true,
	},
	{
		id: "toggleChat",
		group: "Navigation",
		// ⌘L — with a selection: Add to chat (pin + open Agent); else toggle rail.
		key: "l",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "quickChat",
		group: "Navigation",
		// ⌘K — in-page Quick chat (Ask) from the live PDF / Plaza selection.
		key: "k",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "addSelectionToChat",
		group: "Navigation",
		// ⇧⌘A — pin the live selection as Agent context and focus the composer.
		key: "a",
		meta: true,
		shift: true,
		whenSettingsClosed: true,
	},
	{
		id: "focusSidebar",
		group: "Navigation",
		key: "1",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "focusEditor",
		group: "Navigation",
		key: "2",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "focusNotes",
		group: "Navigation",
		key: "3",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "closeTab",
		group: "Navigation",
		// ⌘W — close top overlay first; else active tab / window.
		// Intentionally NOT whenSettingsClosed: overlays take priority over tabs.
		key: "w",
		meta: true,
	},
	{
		id: "reopenTab",
		group: "Navigation",
		// ⇧⌘T — reopen the most recently closed panel (browser convention).
		key: "t",
		meta: true,
		shift: true,
		whenSettingsClosed: true,
	},
	{
		id: "splitPane",
		group: "Navigation",
		// ⌘\ — Obsidian-style split pane to the right.
		key: "\\",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "nextTab",
		group: "Navigation",
		// ⌥⌘→ — next document tab
		key: "ArrowRight",
		meta: true,
		alt: true,
		whenSettingsClosed: true,
	},
	{
		id: "prevTab",
		group: "Navigation",
		// ⌥⌘← — previous document tab
		key: "ArrowLeft",
		meta: true,
		alt: true,
		whenSettingsClosed: true,
	},
	{
		id: "visualAnnotation",
		group: "App",
		// ⌘. — toggle PDF visual annotation region select (active PDF tab)
		key: ".",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "layoutTranslate",
		group: "App",
		// ⌥A — toggle PDF full-text (layout) translation (active PDF tab).
		// Immersive Translate convention; guard text fields (⌥A types "å").
		key: "a",
		alt: true,
		whenSettingsClosed: true,
	},
	{
		id: "toggleFullscreen",
		group: "App",
		// F11 — exclusive (borderless) fullscreen; Windows only
		key: "F11",
		platforms: ["windows"],
	},
];

function shortcutAvailableOnPlatform(def: ShortcutDef): boolean {
	if (!def.platforms?.length) return true;
	const os = getPlatformOS();
	return os === "windows" || os === "macos" || os === "linux"
		? def.platforms.includes(os)
		: false;
}

/** Secondary aliases that still work (documented lightly). */
const ALIASES: Partial<Record<ShortcutId, ShortcutDef[]>> = {
	toggleSidebar: [
		{
			id: "toggleSidebar",
			group: "Navigation",
			key: "b",
			meta: true,
			whenSettingsClosed: true,
		},
	],
	zoomIn: [
		{
			id: "zoomIn",
			group: "App",
			// ⌘= — alias for zoom in on keyboards where + shares the = key
			key: "=",
			meta: true,
			whenSettingsClosed: true,
		},
	],
};

/** Keys needed to render a chord (registry entries or one-off UI hints). */
export type ShortcutDisplay = Pick<
	ShortcutDef,
	"key" | "meta" | "ctrl" | "alt" | "shift"
>;

/**
 * Platform-aware shortcut label for UI.
 * macOS: Apple symbols (⌘X); Windows/Linux: Ctrl+X style.
 * Not i18n — modifier names follow the OS, not the app language.
 */
export function formatShortcut(def: ShortcutDisplay): string {
	if (def.key === "Escape") return "Esc";

	const isMac =
		typeof navigator !== "undefined" &&
		/Mac|iPhone|iPad|iPod/.test(navigator.platform);

	const parts: string[] = [];
	if (def.ctrl) parts.push(isMac ? "⌃" : "Ctrl");
	if (def.alt) parts.push(isMac ? "⌥" : "Alt");
	if (def.shift) parts.push(isMac ? "⇧" : "Shift");
	if (def.meta) parts.push(isMac ? "⌘" : "Ctrl");

	const keyLabel =
		def.key === "," || def.key === "."
			? def.key
			: def.key === "Backspace"
				? isMac
					? "⌫"
					: "Backspace"
				: def.key === "Escape"
					? "Esc"
					: def.key === "ArrowRight"
						? "→"
						: def.key === "ArrowLeft"
							? "←"
							: def.key.length === 1
								? def.key.toUpperCase()
								: def.key;
	parts.push(keyLabel);
	return parts.join(isMac ? "" : "+");
}

/** Primary-mod + key (⌘K / Ctrl+K) for ad-hoc menu / tooltip hints. */
export function formatModShortcut(
	key: string,
	extras?: Omit<ShortcutDisplay, "key" | "meta">,
): string {
	return formatShortcut({ key, meta: true, ...extras });
}

/** Format the primary shortcut for an id (platform-aware) for tooltip interpolation. */
export function formatShortcutById(id: ShortcutId): string {
	const def = SHORTCUTS.find((s) => s.id === id);
	return def ? formatShortcut(def) : "";
}

export function matchShortcut(event: KeyboardEvent, def: ShortcutDef): boolean {
	const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
	const defKey = def.key.length === 1 ? def.key.toLowerCase() : def.key;
	// macOS composes ⌥+letter into a single character (⌥A → "å"), so event.key
	// never equals the def letter. Alt-only letter shortcuts fall back to the
	// physical key (event.code), which stays stable across layouts.
	const physicalKey = /^Key[A-Z]$/.test(event.code)
		? event.code.slice(3).toLowerCase()
		: null;
	if (
		key !== defKey &&
		event.key !== def.key &&
		!(def.alt && !def.meta && physicalKey === defKey)
	)
		return false;

	const wantMeta = Boolean(def.meta);
	const wantAlt = Boolean(def.alt);
	const wantShift = Boolean(def.shift);
	const wantCtrl = Boolean(def.ctrl);

	// On Windows/Linux, treat Ctrl as ⌘ equivalent when meta is required.
	const metaOrCtrl = event.metaKey || event.ctrlKey;
	if (wantMeta) {
		if (!metaOrCtrl) return false;
	} else if (event.metaKey) {
		return false;
	}

	if (wantCtrl && !wantMeta && !event.ctrlKey) return false;
	if (wantAlt !== event.altKey) return false;
	if (wantShift !== event.shiftKey) return false;

	// When meta maps to ctrl on non-Mac, ignore pure ctrl-only false positives
	if (!wantMeta && !wantCtrl && event.ctrlKey) return false;

	return true;
}

export function resolveShortcutId(
	event: KeyboardEvent,
	opts: {
		/** Any app overlay open (settings / dialogs / palette). */
		settingsOpen: boolean;
	},
): ShortcutId | null {
	const overlayOpen = opts.settingsOpen;
	const candidates = SHORTCUTS.flatMap((def) => {
		const aliases = ALIASES[def.id] ?? [];
		return [def, ...aliases];
	});

	for (const def of candidates) {
		if (!shortcutAvailableOnPlatform(def)) continue;
		if (def.whenSettingsOpen && !overlayOpen) continue;
		if (def.whenSettingsClosed && overlayOpen) continue;
		if (matchShortcut(event, def)) return def.id;
	}
	return null;
}

export function shortcutsByGroup(): {
	group: ShortcutGroup;
	items: ShortcutDef[];
}[] {
	const order = ["App", "Vault", "Navigation"] as const;
	return order.map((group) => ({
		group,
		items: SHORTCUTS.filter(
			(s) => s.group === group && shortcutAvailableOnPlatform(s),
		),
	}));
}
