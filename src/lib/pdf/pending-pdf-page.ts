/**
 * One-shot "open this PDF on page N" intent for citation / wiki jumps.
 *
 * Reading-position restore and the citation jumper race on first open: the
 * jumper may scroll to `#page=N` before the document finishes laying out, then
 * restore (or EmbedPDF init) snaps back to page 1 / the saved page. Stashing
 * the target here lets restore prefer the citation page, and lets the jumper
 * re-apply briefly until the viewport settles.
 */

type PendingIntent = {
	page: number;
	keys: Set<string>;
};

const byKey = new Map<string, PendingIntent>();

function normalizeKey(key: string): string {
	return key.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Register a 1-based pending page under one or more paper-key aliases. */
export function setPendingPdfPage(
	keys: string | Iterable<string>,
	page: number,
): void {
	const pageNumber = Math.floor(page);
	if (pageNumber < 1) return;

	const list = typeof keys === "string" ? [keys] : Array.from(keys);
	const intent: PendingIntent = { page: pageNumber, keys: new Set() };
	for (const key of list) {
		if (!key) continue;
		const normalized = normalizeKey(key);
		clearPendingPdfPage(normalized);
		intent.keys.add(normalized);
		byKey.set(normalized, intent);
	}
}

/** Peek without consuming. */
export function peekPendingPdfPage(key: string): number | null {
	const intent = byKey.get(normalizeKey(key));
	return intent && intent.page >= 1 ? intent.page : null;
}

/**
 * Take the pending page for this key (and all aliases registered with it).
 * Returns null when none.
 */
export function consumePendingPdfPage(key: string): number | null {
	const normalized = normalizeKey(key);
	const intent = byKey.get(normalized);
	if (!intent || intent.page < 1) return null;
	for (const alias of intent.keys) byKey.delete(alias);
	return intent.page;
}

/** Drop pending intent for these keys (and shared aliases). */
export function clearPendingPdfPage(keys: string | Iterable<string>): void {
	const list = typeof keys === "string" ? [keys] : Array.from(keys);
	for (const key of list) {
		if (!key) continue;
		const intent = byKey.get(normalizeKey(key));
		if (!intent) continue;
		for (const alias of intent.keys) byKey.delete(alias);
	}
}
