/**
 * Per-paper "resume reading" position (last visited page), kept in localStorage
 * so reopening a PDF returns to where you left off. Keyed by a stable paper
 * path; loose PDFs without a paper path are not tracked.
 */

import { readJsonStorage, writeJsonStorage } from "@/lib/core/storage";

const KEY = "agentero-pdf-reading-pos";

function readMap(): Record<string, number> {
	const parsed = readJsonStorage<unknown>(KEY, {});
	return parsed && typeof parsed === "object" && !Array.isArray(parsed)
		? (parsed as Record<string, number>)
		: {};
}

/** Last read 1-based page for a paper key, or 0 when none worth restoring. */
export function readReadingPage(key: string): number {
	const n = readMap()[key];
	return typeof n === "number" && n > 1 ? Math.floor(n) : 0;
}

export function writeReadingPage(key: string, page: number): void {
	const map = readMap();
	if (page > 1) map[key] = Math.floor(page);
	else delete map[key];
	writeJsonStorage(KEY, map);
}
