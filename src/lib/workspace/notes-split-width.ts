import type { DockviewApi } from "dockview-react";
import { readJsonStorage, writeJsonStorage } from "@/lib/core/storage";

const STORAGE_KEY = "agentero.notesSplitRatio.v1";

/** Only the standard two-column reading layout owns this shared preference. */
function readingColumns(api: DockviewApi, paperId: string, notesId: string) {
	const paper = api.getPanel(paperId)?.group;
	const notes = api.getPanel(notesId)?.group;
	if (!paper || !notes || paper === notes) return null;
	const groups = api.groups.filter(
		(group) => group.api.location.type === "grid",
	);
	if (groups.length !== 2 || !groups.includes(paper) || !groups.includes(notes))
		return null;
	const left = paper.api.boundingBox;
	const right = notes.api.boundingBox;
	if (
		!left ||
		!right ||
		left.width <= 0 ||
		right.width <= 0 ||
		Math.abs(left.top - right.top) > 1 ||
		Math.abs(left.height - right.height) > 1 ||
		left.left >= right.left
	)
		return null;
	return { notes, total: left.width + right.width, width: right.width };
}

export function rememberNotesSplitWidth(
	api: DockviewApi,
	paperId: string,
	notesId: string,
): void {
	const columns = readingColumns(api, paperId, notesId);
	if (!columns) return;
	const ratio = columns.width / columns.total;
	if (ratio > 0 && ratio < 1) writeJsonStorage(STORAGE_KEY, ratio);
}

export function restoreNotesSplitWidth(
	api: DockviewApi,
	paperId: string,
	notesId: string,
): void {
	const ratio = readJsonStorage<unknown>(STORAGE_KEY, null);
	if (
		typeof ratio !== "number" ||
		!Number.isFinite(ratio) ||
		ratio <= 0 ||
		ratio >= 1
	)
		return;
	const columns = readingColumns(api, paperId, notesId);
	if (columns)
		columns.notes.api.setSize({ width: Math.round(columns.total * ratio) });
}
