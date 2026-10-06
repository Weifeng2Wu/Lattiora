/**
 * Text editor font size preference (independent of app theme).
 * Persisted per install and broadcast so every open editor follows the switch.
 */

import { readJsonStorage, writeJsonStorage } from "@/lib/core/storage";

const TEXT_EDITOR_FONT_SIZE_STORAGE_KEY = "agentero-text-editor-font-size";
export const TEXT_EDITOR_FONT_SIZE_EVENT = "agentero:text-editor-font-size";

const DEFAULT_FONT_SIZE = 14;
const FONT_SIZES = [12, 13, 14, 15, 16, 18, 20] as const;
export type TextEditorFontSize = (typeof FONT_SIZES)[number];

export { FONT_SIZES };

/** Stored preference, falling back to 14 on first use. */
export function readTextEditorFontSize(): TextEditorFontSize {
	const stored = readJsonStorage<number | null>(
		TEXT_EDITOR_FONT_SIZE_STORAGE_KEY,
		null,
	);
	if (stored !== null && FONT_SIZES.includes(stored as TextEditorFontSize)) {
		return stored as TextEditorFontSize;
	}
	return DEFAULT_FONT_SIZE;
}

export function writeTextEditorFontSize(next: TextEditorFontSize): void {
	writeJsonStorage(TEXT_EDITOR_FONT_SIZE_STORAGE_KEY, next);
	if (typeof window !== "undefined") {
		window.dispatchEvent(
			new CustomEvent<TextEditorFontSize>(TEXT_EDITOR_FONT_SIZE_EVENT, {
				detail: next,
			}),
		);
	}
}
