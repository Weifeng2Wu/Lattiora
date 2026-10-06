/**
 * Identity of the selection that auto-translate has already run for.
 *
 * The floating selection menu is re-placed on every scroll tick so it stays
 * glued to the selection, and re-placing replaces the menu *object* because its
 * `screen` moved — the anchor it points at is untouched. Keying "already
 * translated?" on menu identity therefore re-ran the translation on every wheel
 * tick, appending a translate record each time; the gutter then stacked those
 * identical `文A` pins into one vertical column. A translation belongs to an
 * anchor, so that is what gets fingerprinted.
 */

import type { PdfAskAnchor } from "@/lib/pdf/ask/types";

/**
 * Stable key for a selection anchor, or `null` when it cannot be translated
 * (no anchor at all, or an empty quote — the caller's guard uses the same
 * null to skip auto-translate).
 */
export function selectionAnchorKey(
	anchor: PdfAskAnchor | null | undefined,
): string | null {
	const quote = anchor?.quote?.trim();
	if (!anchor || !quote) return null;
	const rects = anchor.rects
		.map((r) => `${r.x},${r.y},${r.w},${r.h}`)
		.join("~");
	return `${anchor.page}|${anchor.trigger}|${rects}|${quote}`;
}
