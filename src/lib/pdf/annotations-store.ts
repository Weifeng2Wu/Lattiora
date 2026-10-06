/**
 * PDF annotation state per open tab (highlights + ask threads + visual traces),
 * zustand vanilla. Only the annotations side panel and the owning viewers
 * subscribe — a selection highlight no longer re-renders the whole App.
 */

import { createStore } from "zustand/vanilla";
import type { PdfVisualSessionTrace } from "@/lib/pdf/agent-trace/types";
import type { PdfAskThread } from "@/lib/pdf/ask/types";
import type { PdfHighlight } from "@/lib/pdf/highlight/types";

type AnnotationsStore = {
	highlightsByTab: Record<string, PdfHighlight[]>;
	asksByTab: Record<string, PdfAskThread[]>;
	visualTracesByTab: Record<string, PdfVisualSessionTrace[]>;
};

export const annotationsStore = createStore<AnnotationsStore>(() => ({
	highlightsByTab: {},
	asksByTab: {},
	visualTracesByTab: {},
}));

export function setTabHighlights(tabId: string, list: PdfHighlight[]): void {
	annotationsStore.setState((s) => {
		if (s.highlightsByTab[tabId] === list) return s;
		return {
			highlightsByTab: { ...s.highlightsByTab, [tabId]: list },
		};
	});
}

export function setTabAsks(tabId: string, list: PdfAskThread[]): void {
	annotationsStore.setState((s) => {
		if (s.asksByTab[tabId] === list) return s;
		return {
			asksByTab: { ...s.asksByTab, [tabId]: list },
		};
	});
}

export function setTabVisualTraces(
	tabId: string,
	list: PdfVisualSessionTrace[],
): void {
	annotationsStore.setState((s) => {
		// Same array reference → no update (prevents publish-effect infinite loops
		// when parent passes an unstable onVisualTracesChange callback).
		if (s.visualTracesByTab[tabId] === list) return s;
		return {
			visualTracesByTab: { ...s.visualTracesByTab, [tabId]: list },
		};
	});
}

function dropKeys<T>(
	map: Record<string, T>,
	tabIds: string[],
): { next: Record<string, T>; changed: boolean } {
	let changed = false;
	const next = { ...map };
	for (const id of tabIds) {
		if (id in next) {
			delete next[id];
			changed = true;
		}
	}
	return { next, changed };
}

function remapKeys<T>(
	map: Record<string, T>,
	remap: Array<{ fromId: string; toId: string }>,
): { next: Record<string, T>; changed: boolean } {
	let changed = false;
	const next = { ...map };
	for (const { fromId, toId } of remap) {
		if (fromId === toId || !(fromId in next)) continue;
		next[toId] = next[fromId];
		delete next[fromId];
		changed = true;
	}
	return { next, changed };
}

/** Drop annotation state for closed panels (highlights + asks + visual traces). */
export function removeTabAnnotations(tabIds: string[]): void {
	if (!tabIds.length) return;
	annotationsStore.setState((s) => {
		const highlights = dropKeys(s.highlightsByTab, tabIds);
		const asks = dropKeys(s.asksByTab, tabIds);
		const visual = dropKeys(s.visualTracesByTab, tabIds);
		if (!highlights.changed && !asks.changed && !visual.changed) return s;
		return {
			highlightsByTab: highlights.next,
			asksByTab: asks.next,
			visualTracesByTab: visual.next,
		};
	});
}

/** Re-key annotation state after a filesystem move changed panel ids. */
export function remapTabAnnotations(
	remap: Array<{ fromId: string; toId: string }>,
): void {
	if (!remap.length) return;
	annotationsStore.setState((s) => {
		const highlights = remapKeys(s.highlightsByTab, remap);
		const asks = remapKeys(s.asksByTab, remap);
		const visual = remapKeys(s.visualTracesByTab, remap);
		if (!highlights.changed && !asks.changed && !visual.changed) return s;
		return {
			highlightsByTab: highlights.next,
			asksByTab: asks.next,
			visualTracesByTab: visual.next,
		};
	});
}

/**
 * Drop every tab's annotations. All state here is tab-keyed and a vault switch
 * closes all tabs, so nothing survives that the next vault could use.
 */
export function clearAnnotationsVaultState(): void {
	annotationsStore.setState({
		highlightsByTab: {},
		asksByTab: {},
		visualTracesByTab: {},
	});
}
