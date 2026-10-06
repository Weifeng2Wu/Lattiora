import type { TrashEntry, TrashResult } from "@/lib/core/bindings";
import {
	cloudRelative,
	listLocalFiles,
	moveLocal,
	removeLocal,
	writeLocalFile,
} from "./files";
import { exists, readTextFile, stat } from "./fs";

const ROOT = ".agentero/.trash";
export async function trashCloudPaths(paths: string[]): Promise<TrashResult> {
	const batchId = crypto.randomUUID();
	const normalized = [...new Set(paths.map(cloudRelative))];
	const rels = normalized.filter(
		(path) =>
			!normalized.some(
				(other) => other !== path && path.startsWith(`${other}/`),
			),
	);
	const moved: string[] = [];
	for (const rel of rels) {
		if (
			!rel ||
			rel.startsWith(".agentero/") ||
			rel === "papers" ||
			rel === "notes"
		)
			throw new Error(`Cannot trash workspace root: ${rel}`);
		if (!(await exists(rel))) continue;
		const stored = `${crypto.randomUUID()}-${rel.split("/").at(-1)}`;
		const entry: TrashEntry = {
			id: `${batchId}::${stored}`,
			batchId,
			stored,
			rel,
			name: rel.split("/").at(-1) || rel,
			deletedAt: new Date().toISOString(),
			isDir: (await stat(rel)).isDirectory,
		};
		// Write the restore manifest first. If a move fails, it remains discoverable for recovery.
		await writeLocalFile(
			`${ROOT}/${batchId}/${stored}.entry.json`,
			new Blob([JSON.stringify(entry)], { type: "application/json" }),
		);
		await moveLocal(rel, `${ROOT}/${batchId}/${stored}`);
		moved.push(rel);
	}
	return { batchId, count: moved.length, rels: moved };
}
export async function listCloudTrash(): Promise<TrashEntry[]> {
	const files = (await listLocalFiles()).filter(
		(f) =>
			!f.deleted &&
			f.path.startsWith(`${ROOT}/`) &&
			f.path.endsWith(".entry.json"),
	);
	return Promise.all(
		files.map(
			async (f) => JSON.parse(await readTextFile(f.path)) as TrashEntry,
		),
	);
}
async function find(batchId: string, stored: string): Promise<TrashEntry> {
	const entry = (await listCloudTrash()).find(
		(e) => e.batchId === batchId && e.stored === stored,
	);
	if (!entry) throw new Error("Recycle-bin entry not found");
	return entry;
}
export async function restoreCloudTrash(batchId: string, stored: string) {
	const entry = await find(batchId, stored);
	await moveLocal(`${ROOT}/${batchId}/${stored}`, entry.rel);
	await removeLocal(`${ROOT}/${batchId}/${stored}.entry.json`);
	return { rel: entry.rel };
}
export async function purgeCloudTrash(
	batchId?: string,
	stored?: string,
): Promise<null> {
	if (batchId && stored) {
		await find(batchId, stored);
		await removeLocal(`${ROOT}/${batchId}/${stored}`, true);
		await removeLocal(`${ROOT}/${batchId}/${stored}.entry.json`);
	} else if (await exists(ROOT)) await removeLocal(ROOT, true);
	return null;
}
