/**
 * Lightweight app commands for the Command Palette (⇧⌘P).
 * Aligns with VS Code: discoverable actions, not only resource search.
 */

export type PaletteMode = "go" | "commands";

export type AppCommand = {
	/** Stable id, e.g. `settings.open` */
	id: string;
	/** i18n key under `app:` namespace (or full key with ns) */
	titleKey: string;
	/** Optional category i18n key for grouping / prefix display */
	categoryKey?: string;
	/** Extra terms for fuzzy match (English keywords) */
	keywords?: string[];
	/** When false, hide from the palette */
	when?: () => boolean;
	run: () => void | Promise<void>;
};
