import { meanRectY } from "@/lib/paper/reading-heatmap/aggregate";
import type { ReadingActivityPoint } from "@/lib/paper/reading-heatmap/types";
import { parsePdfAskThread } from "@/lib/pdf/ask/schema";
import { parsePdfHighlight } from "@/lib/pdf/highlight/schema";
import { parsePdfTranslateRecord } from "@/lib/pdf/translate/schema";
import { cloudRelative, listLocalFiles, readLocalFile } from "./files";

/** Derive the original Library heatmap from synced per-mark files, not usage telemetry. */
export function markReadingActivity(raw: unknown): ReadingActivityPoint | null {
	const highlight = parsePdfHighlight(raw);
	if (highlight)
		return {
			kind: "highlight",
			page: Math.max(1, Math.floor(highlight.page)),
			y: meanRectY(highlight.rects),
			weight: 1,
		};
	const ask = parsePdfAskThread(raw);
	if (ask)
		return {
			kind: "ask",
			page: Math.max(1, Math.floor(ask.anchor.page)),
			y: meanRectY(ask.anchor.rects),
			weight: Math.max(
				1,
				ask.messages.filter((message) => message.role !== "system").length,
			),
		};
	const translation = parsePdfTranslateRecord(raw);
	if (translation)
		return {
			kind: "translate",
			page: Math.max(1, Math.floor(translation.page)),
			y: meanRectY(translation.rects),
			weight: 1,
		};
	return null;
}
export async function readCloudReadingActivity(
	paths: string[],
): Promise<Record<string, ReadingActivityPoint[]>> {
	const result: Record<string, ReadingActivityPoint[]> = {};
	const keys = new Map(paths.map((path) => [cloudRelative(path), path]));
	for (const key of paths) result[key] = [];
	for (const file of await listLocalFiles()) {
		if (file.deleted) continue;
		const match = /^(.*)\/marks\/([^/]+\.json)$/.exec(file.path);
		if (!match || match[2] === "annotations.json") continue;
		const key = keys.get(match[1]);
		if (!key) continue;
		try {
			const raw = JSON.parse(await (await readLocalFile(file.path)).text());
			const point = markReadingActivity(raw);
			if (point) result[key].push(point);
		} catch {
			/* Same as the original mark reader: ignore corrupt individual sidecars. */
		}
	}
	return result;
}
