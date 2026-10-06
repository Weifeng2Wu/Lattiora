import { listLocalFiles, writeLocalFile } from "./files";

export const CAPTURE_ROOT = "notes/quick-captures/";
export async function saveQuickCapture(text: string) {
	const content = text.trim();
	if (!content || content.length > 10000) throw new Error("invalidRequest");
	const date = new Date().toISOString();
	const path = `${CAPTURE_ROOT}${date.replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}.md`;
	await writeLocalFile(
		path,
		new Blob([content + "\n"], { type: "text/markdown" }),
		{ expectedLocalId: null },
	);
	return path;
}
export async function recentQuickCaptures() {
	const files = (await listLocalFiles())
		.filter(
			(file) =>
				!file.deleted &&
				file.data &&
				file.path.startsWith(CAPTURE_ROOT) &&
				file.path.endsWith(".md"),
		)
		.sort((a, b) => b.updated_at - a.updated_at)
		.slice(0, 5);
	return Promise.all(
		files.map(async (file) => ({
			path: file.path,
			text: await file.data!.text(),
			updatedAt: file.updated_at,
		})),
	);
}
