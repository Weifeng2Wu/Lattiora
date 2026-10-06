import {
	createVisualDocument,
	type Kanban,
	parseVisualDocument,
} from "@/lib/workspace/visual-documents";
import { assertAgentDocumentClean } from "./agent-edits";
import { isConflictPath } from "./conflicts";
import { cloudLock, localTransaction } from "./db";
import {
	editedFile,
	filesChanged,
	listLocalFiles,
	writeLocalFile,
} from "./files";
import { MAX_FILE_BYTES } from "./protocol";

export type HomeBoard = { path: string; localId: string; doc: Kanban };

export async function loadHomeOverview() {
	const files = (await listLocalFiles()).filter(
		(file) =>
			!file.deleted &&
			file.mime !== "inode/directory" &&
			!isConflictPath(file.path) &&
			!file.path.split("/").some((part) => part.startsWith(".")),
	);
	const boards: HomeBoard[] = [];
	let unavailable = 0;
	for (const file of files.filter((file) =>
		/\.kanban\.json$/i.test(file.path),
	)) {
		try {
			if (!file.data) throw new Error("notCached");
			const doc = parseVisualDocument(await file.data.text(), "kanban");
			if (doc.type === "kanban")
				boards.push({ path: file.path, localId: file.localId, doc });
		} catch {
			unavailable++;
		}
	}
	return {
		notes: files.filter((file) => /\.(md|mdx|markdown)$/i.test(file.path))
			.length,
		boards: boards.sort((a, b) => a.path.localeCompare(b.path)),
		unavailable,
	};
}

/** An explicit choice wins; only standard Done labels are recognized otherwise. */
export function homeDoneColumn(doc: Kanban, preferred?: string) {
	if (preferred !== undefined)
		return doc.columns.find((column) => column.id === preferred) ?? null;
	const matches = doc.columns.filter((column) =>
		/^(done|completed|已完成)$/i.test(column.title.trim()),
	);
	return matches.length === 1 ? matches[0] : null;
}

/** Existing boards remain ordinary files, protected by their viewed revision. */
export async function saveHomeBoard(board: HomeBoard, doc: Kanban) {
	const content = JSON.stringify(doc, null, 2);
	parseVisualDocument(content, "kanban");
	const data = new Blob([content], { type: "application/json" });
	if (data.size > MAX_FILE_BYTES) throw new Error("tooLarge");
	await cloudLock("files", async () => {
		await assertAgentDocumentClean(board.path);
		await localTransaction((files) => {
			const current = files.get(board.path);
			if (!current || current.deleted || current.localId !== board.localId)
				throw new Error("localConflict");
			files.set(board.path, editedFile(board.path, data, current));
		});
	});
	filesChanged([board.path]);
}

export async function createHomeBoard(title: string, columns: string[]) {
	const doc = createVisualDocument("kanban", { topic: "", columns }) as Kanban;
	doc.columns[0].cards.push({
		id: crypto.randomUUID(),
		title,
		description: "",
	});
	// A unique filename also preserves malformed or concurrently created boards.
	const path = `notes/tasks-${crypto.randomUUID().slice(0, 8)}.kanban.json`;
	await writeLocalFile(
		path,
		new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }),
		{ expectedLocalId: null },
	);
	return path;
}
