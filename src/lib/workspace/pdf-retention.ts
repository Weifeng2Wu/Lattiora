import type { DocTab } from "@/lib/workspace/tabs/types";

/** Keep promoted PDFs first, then retain still-open entries from the previous LRU. */
export function nextPdfLru(
	previous: string[],
	availablePdfIds: readonly string[],
	promotedIds: readonly string[],
	limit: number,
): string[] {
	const available = new Set(availablePdfIds);
	const seen = new Set<string>();
	const next: string[] = [];
	for (const id of [...promotedIds, ...previous]) {
		if (!available.has(id) || seen.has(id)) continue;
		seen.add(id);
		next.push(id);
		if (next.length >= limit) break;
	}
	if (
		next.length === previous.length &&
		next.every((id, index) => id === previous[index])
	) {
		return previous;
	}
	return next;
}

/** Release local PDF buffers after their viewer leaves the visible/recent set. */
export function evictPdfBuffers(
	tabs: DocTab[],
	retainedIds: ReadonlySet<string>,
): DocTab[] {
	let changed = false;
	const next = tabs.map((tab) => {
		if (tab.mode !== "pdf" || tab.pdfBytes == null || retainedIds.has(tab.id)) {
			return tab;
		}
		changed = true;
		return { ...tab, pdfBytes: null, loaded: false };
	});
	return changed ? next : tabs;
}
