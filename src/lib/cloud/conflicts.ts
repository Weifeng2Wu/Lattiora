import { assertAgentDocumentClean } from "./agent-edits";
import { cloudLock, type LocalFile, localTransaction } from "./db";
import { editedFile, filesChanged, listLocalFiles } from "./files";
import { MAX_FILE_BYTES, validPath } from "./protocol";

export const isConflictPath = (path: string) =>
	path === "Conflicts" || path.startsWith("Conflicts/");

export type FileConflict = {
	id: string;
	path: string;
	current?: LocalFile;
	recovered?: LocalFile;
	manifest?: LocalFile;
	/** Every compared revision is checked again when committing a choice. */
};

export async function listFileConflicts(): Promise<FileConflict[]> {
	const files = new Map((await listLocalFiles()).map((f) => [f.path, f]));
	const conflicts: FileConflict[] = [];
	const used = new Set<string>();
	for (const file of files.values()) {
		if (file.deleted || !/^Conflicts\/[^/]+\/conflict\.json$/.test(file.path))
			continue;
		try {
			const value = JSON.parse(await file.data!.text());
			const root = file.path.slice(0, -"conflict.json".length);
			if (
				typeof value.originalPath !== "string" ||
				!validPath(value.originalPath) ||
				typeof value.localDeleted !== "boolean"
			)
				continue;
			const recoveryPath = `${root}${value.originalPath}`;
			if (value.localDeleted !== true && value.recoveryPath !== recoveryPath)
				continue;
			const recovered = files.get(recoveryPath);
			// A manifest can arrive before its data during incremental sync.
			if (
				!value.localDeleted &&
				(!recovered || recovered.deleted || !recovered.data)
			)
				continue;
			used.add(recoveryPath);
			used.add(file.path);
			conflicts.push({
				id: file.path,
				path: value.originalPath,
				current: files.get(value.originalPath),
				recovered: value.localDeleted ? undefined : recovered,
				manifest: file,
			});
		} catch {
			// Invalid/legacy metadata remains downloadable as an individual conflict.
		}
	}
	for (const file of files.values()) {
		if (
			file.deleted ||
			file.mime === "inode/directory" ||
			!isConflictPath(file.path) ||
			used.has(file.path)
		)
			continue;
		const match = /^Conflicts\/[^/]+\/(.+)$/.exec(file.path);
		if (!match || !validPath(match[1])) continue;
		// Do not treat a pending sync manifest as a user document.
		if (match[1] === "conflict.json") continue;
		conflicts.push({
			id: file.path,
			path: match[1],
			current: files.get(match[1]),
			recovered: file,
		});
	}
	return conflicts.sort(
		(a, b) => a.path.localeCompare(b.path) || a.id.localeCompare(b.id),
	);
}

export const conflictVersionExists = (file?: LocalFile) =>
	!!file && !file.deleted;
export const conflictTextSupported = (conflict: FileConflict) =>
	[conflict.current, conflict.recovered].every(
		(f) =>
			!conflictVersionExists(f) ||
			(!!f?.data &&
				f.size <= 128 * 1024 &&
				/^(text\/|application\/(json|xml))/.test(f.mime)),
	);

async function conflictVersionsIdentical({
	current,
	recovered,
	manifest,
}: FileConflict): Promise<boolean> {
	// Missing data during incremental sync is not evidence of equal deletions.
	if (!current) return false;
	if (current.deleted) return !!manifest && !recovered;
	if (
		!recovered ||
		recovered.deleted ||
		current.mime === "inode/directory" ||
		current.mime !== recovered.mime ||
		!current.data ||
		!recovered.data ||
		current.data.size !== recovered.data.size
	)
		return false;
	// Bound memory for PDFs and other large binaries; never compare decoded text.
	const chunkSize = 1024 * 1024;
	for (let offset = 0; offset < current.data.size; offset += chunkSize) {
		const [left, right] = await Promise.all(
			[current.data, recovered.data].map(
				async (data) =>
					new Uint8Array(
						await data.slice(offset, offset + chunkSize).arrayBuffer(),
					),
			),
		);
		if (left.some((byte, index) => byte !== right[index])) return false;
	}
	return true;
}

export type ConflictBatchResult = {
	resolved: number;
	skipped: number;
	failed: { path: string; error: unknown }[];
};

/** Process only this snapshot; each resolution rechecks revisions and editor state. */
export async function resolveIdenticalFileConflicts(
	conflicts: readonly FileConflict[],
): Promise<ConflictBatchResult> {
	const result: ConflictBatchResult = { resolved: 0, skipped: 0, failed: [] };
	for (const conflict of conflicts) {
		try {
			if (!(await conflictVersionsIdentical(conflict))) {
				result.skipped++;
				continue;
			}
			await resolveFileConflict(conflict, "current");
			result.resolved++;
		} catch (error) {
			result.failed.push({ path: conflict.path, error });
		}
	}
	return result;
}

export async function resolveFileConflict(
	conflict: FileConflict,
	choice: "current" | "recovered" | "merged",
	merged?: string,
): Promise<void> {
	if (!validPath(conflict.path)) throw new Error("invalidPath");
	if (
		choice === "merged" &&
		(!conflictTextSupported(conflict) || typeof merged !== "string")
	)
		throw new Error("invalidFile");
	const source = choice === "current" ? conflict.current : conflict.recovered;
	const data =
		choice === "merged"
			? new Blob([merged!], {
					type:
						conflict.current?.mime ?? conflict.recovered?.mime ?? "text/plain",
				})
			: conflictVersionExists(source)
				? source!.data
				: null;
	if (choice !== "merged" && conflictVersionExists(source) && !data)
		throw new Error("notCached");
	if (data && data.size > MAX_FILE_BYTES) throw new Error("tooLarge");
	const archive = `.agentero/conflict-history/${crypto.randomUUID()}`;
	const changed: string[] = [];
	await cloudLock("files", async () => {
		await assertAgentDocumentClean(conflict.path);
		await localTransaction((files) => {
			const same = (path: string, snapshot?: LocalFile) =>
				files.get(path)?.localId === snapshot?.localId;
			if (
				!same(conflict.path, conflict.current) ||
				(conflict.recovered &&
					!same(conflict.recovered.path, conflict.recovered)) ||
				(conflict.manifest && !same(conflict.manifest.path, conflict.manifest))
			)
				throw new Error("localConflict");
			for (const [name, file] of [
				["current", conflict.current],
				["recovered", conflict.recovered],
			] as const) {
				if (!conflictVersionExists(file)) continue;
				if (!file!.data) throw new Error("notCached");
				const path = `${archive}/${name}`;
				files.set(path, editedFile(path, file!.data));
				changed.push(path);
			}
			const record = `${archive}/resolution.json`;
			files.set(
				record,
				editedFile(
					record,
					new Blob(
						[
							JSON.stringify({
								path: conflict.path,
								choice,
								conflictId: conflict.id,
								savedAt: new Date().toISOString(),
								currentDeleted: !conflictVersionExists(conflict.current),
								recoveredDeleted: !conflictVersionExists(conflict.recovered),
							}),
						],
						{ type: "application/json" },
					),
				),
			);
			changed.push(record);
			if (choice !== "current") {
				// No implicit replacement of a directory or its descendants.
				if (
					conflict.current?.mime === "inode/directory" ||
					source?.mime === "inode/directory" ||
					[...files.values()].some(
						(f) => !f.deleted && f.path.startsWith(`${conflict.path}/`),
					)
				)
					throw new Error("pathExists");
				for (
					let parent = conflict.path.slice(0, conflict.path.lastIndexOf("/"));
					conflict.path.includes("/") && parent;
					parent = parent.includes("/")
						? parent.slice(0, parent.lastIndexOf("/"))
						: ""
				) {
					const entry = files.get(parent);
					if (entry && !entry.deleted && entry.mime !== "inode/directory")
						throw new Error("pathExists");
				}
				files.set(
					conflict.path,
					editedFile(conflict.path, data, files.get(conflict.path)),
				);
				changed.push(conflict.path);
			}
			for (const file of [conflict.recovered, conflict.manifest]) {
				if (!file) continue;
				files.set(file.path, editedFile(file.path, null, files.get(file.path)));
				changed.push(file.path);
			}
		});
	});
	filesChanged(changed);
}

export type ConflictDiff = {
	current: string;
	recovered: string;
	changed: boolean;
};
/** Bounded line LCS; retain exact line endings so choices never reformat notes. */
export function compareConflictText(
	current: string,
	recovered: string,
): ConflictDiff[] {
	const split = (s: string) => s.match(/[^\n]*\n|[^\n]+$/g) ?? [];
	const a = split(current),
		b = split(recovered);
	if ((a.length + 1) * (b.length + 1) > 1_000_000)
		return [{ current, recovered, changed: current !== recovered }];
	const width = b.length + 1;
	const lengths = new Uint32Array((a.length + 1) * width);
	for (let i = a.length - 1; i >= 0; i--)
		for (let j = b.length - 1; j >= 0; j--)
			lengths[i * width + j] =
				a[i] === b[j]
					? 1 + lengths[(i + 1) * width + j + 1]
					: Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
	const chunks: ConflictDiff[] = [];
	const append = (left: string, right: string, changed: boolean) => {
		const last = chunks.at(-1);
		if (last && last.changed === changed) {
			last.current += left;
			last.recovered += right;
		} else chunks.push({ current: left, recovered: right, changed });
	};
	let i = 0,
		j = 0;
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) {
			append(a[i++], b[j++], false);
		} else if (
			i < a.length &&
			(j === b.length ||
				lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])
		)
			append(a[i++], "", true);
		else append("", b[j++], true);
	}
	return chunks;
}
