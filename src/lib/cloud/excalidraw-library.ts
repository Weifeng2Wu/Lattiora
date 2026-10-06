import type { LibraryItems } from "@excalidraw/excalidraw/types";
import { localTransaction } from "./db";
import { writeLocalFile } from "./files";

export const EXCALIDRAW_LIBRARY_PATH =
	".agentero/excalidraw/library.excalidrawlib";

export async function readExcalidrawLibrary(): Promise<{
	seed: string;
	items: LibraryItems;
}> {
	const file = await localTransaction(
		(files) => files.get(EXCALIDRAW_LIBRARY_PATH),
		false,
	);
	if (!file || file.deleted) return { seed: "", items: [] };
	if (!file.data) throw new Error("notCached");
	const seed = await file.data.text();
	const data = JSON.parse(seed);
	if (
		data?.type !== "excalidrawlib" ||
		data.version !== 2 ||
		!Array.isArray(data.libraryItems)
	)
		throw new Error("Invalid Excalidraw library");
	return { seed, items: data.libraryItems };
}

export async function writeExcalidrawLibrary(
	content: string,
	expected: string,
): Promise<void> {
	await writeLocalFile(
		EXCALIDRAW_LIBRARY_PATH,
		new Blob([content], { type: "application/json" }),
		{
			expectedText: expected || null,
			preserveConflict: true,
		},
	);
}
