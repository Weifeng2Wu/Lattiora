import { unzipSync, zipSync } from "fflate";
import { cloudLock, localTransaction } from "./db";
import { editedFile, filesChanged, listLocalFiles, mimeFor } from "./files";
import { MAX_FILE_BYTES, validPath } from "./protocol";

const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
const MANIFEST = "agentero-backup.json";
const encoder = new TextEncoder();
async function hash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
	return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
		.map((n) => n.toString(16).padStart(2, "0"))
		.join("");
}
export function downloadBlob(blob: Blob, name: string) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Portable ZIP contains actual files and checksums; no credentials or session. */
export async function exportBackup(): Promise<Blob> {
	const files = (await listLocalFiles()).filter((file) => !file.deleted);
	const fileBytes = files.reduce((sum, file) => sum + file.size, 0);
	if (files.length > 20_000 || fileBytes > MAX_BACKUP_BYTES)
		throw new Error("backupTooLarge");
	const entries: Record<string, Uint8Array> = {};
	const manifest: Array<{ path: string; mime: string; sha256: string }> = [];
	for (const file of files) {
		if (!file.data) throw new Error("notCached");
		const bytes = new Uint8Array(await file.data.arrayBuffer());
		entries[`files/${file.path}`] = bytes;
		manifest.push({
			path: file.path,
			mime: file.mime,
			sha256: await hash(bytes),
		});
	}
	entries[MANIFEST] = encoder.encode(
		JSON.stringify({
			version: 1,
			createdAt: new Date().toISOString(),
			files: manifest,
		}),
	);
	// Apply the same uncompressed-byte ceiling as restore, including metadata.
	// Never produce an archive that our own importer must refuse.
	if (fileBytes + entries[MANIFEST].byteLength > MAX_BACKUP_BYTES)
		throw new Error("backupTooLarge");
	return new Blob([zipSync(entries, { level: 0 }).buffer as ArrayBuffer], {
		type: "application/zip",
	});
}

/** Validate the entire archive before a single atomic local restore. Existing
 * differing content is retained, and restored files use normal versioned sync. */
export async function restoreBackup(blob: Blob): Promise<number> {
	if (blob.size > MAX_BACKUP_BYTES + 4 * 1024 * 1024)
		throw new Error("backupTooLarge");
	let size = 0;
	const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()), {
		filter: (entry) => {
			size += entry.originalSize;
			if (entry.originalSize > MAX_FILE_BYTES || size > MAX_BACKUP_BYTES)
				throw new Error("backupTooLarge");
			return true;
		},
	});
	if (!entries[MANIFEST]) throw new Error("invalidBackup");
	const manifest = JSON.parse(new TextDecoder().decode(entries[MANIFEST]));
	if (
		manifest.version !== 1 ||
		!Array.isArray(manifest.files) ||
		manifest.files.length > 20_000
	)
		throw new Error("invalidBackup");
	const seen = new Set<string>();
	const restored: Array<{ path: string; data: Blob }> = [];
	for (const file of manifest.files) {
		if (
			!validPath(file.path) ||
			seen.has(file.path) ||
			typeof file.mime !== "string"
		)
			throw new Error("invalidBackup");
		seen.add(file.path);
		const bytes = entries[`files/${file.path}`];
		if (!bytes || (await hash(new Uint8Array(bytes))) !== file.sha256)
			throw new Error("invalidBackup");
		restored.push({
			path: file.path,
			data: new Blob([new Uint8Array(bytes)], {
				type: mimeFor(file.path, file.mime),
			}),
		});
	}
	const root = `Conflicts/restore-${crypto.randomUUID()}`;
	await cloudLock("files", async () => {
		const previous = new Map(
			(await listLocalFiles()).map((file) => [file.path, file]),
		);
		const unchanged = new Set<string>();
		for (const file of restored) {
			const old = previous.get(file.path);
			if (
				old &&
				!old.deleted &&
				old.data &&
				(await hash(new Uint8Array(await old.data.arrayBuffer()))) ===
					(await hash(new Uint8Array(await file.data.arrayBuffer())))
			)
				unchanged.add(file.path);
		}
		await localTransaction((files) => {
			for (const file of restored) {
				if (unchanged.has(file.path)) continue;
				const old = files.get(file.path);
				if (old && !old.deleted && old.data) {
					const recovery = `${root}/${old.path}`;
					files.set(recovery, editedFile(recovery, old.data));
				}
				files.set(file.path, editedFile(file.path, file.data, old));
			}
		});
	});
	filesChanged([...seen, root]);
	return restored.length;
}
