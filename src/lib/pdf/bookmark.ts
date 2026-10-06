import { PdfActionType, type PdfBookmarkObject } from "@embedpdf/models";

/**
 * Resolve the zero-based page index a PDF bookmark points to.
 * Supports direct destinations and GoTo action destinations.
 * Returns null for bookmarks with no target or unsupported action types.
 */
export function bookmarkPageIndex(n: PdfBookmarkObject): number | null {
	if (n.target?.type === "destination") {
		return n.target.destination.pageIndex;
	}
	if (
		n.target?.type === "action" &&
		n.target.action.type === PdfActionType.Goto
	) {
		return n.target.action.destination.pageIndex;
	}
	return null;
}
