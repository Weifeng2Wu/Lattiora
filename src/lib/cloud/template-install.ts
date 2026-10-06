import { cloudLock, localTransaction } from "./db";
import { editedFile, filesChanged, listLocalFiles, mimeFor } from "./files";

const manifestPath = ".agentero/template-manifest.json";
type Manifest = { format: 1; files: Record<string, string> };
const hash = async (text: string) =>
	Array.from(
		new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
		),
		(v) => v.toString(16).padStart(2, "0"),
	).join("");

/** Adopt identical legacy files; upgrade only the last installed bytes. Never resurrect deletions. */
export async function installTemplateFiles(
	bundled: ReadonlyMap<string, string>,
): Promise<string[]> {
	const changed: string[] = [];
	await cloudLock("files", async () => {
		const snapshot = new Map(
			(await listLocalFiles()).map((file) => [file.path, file]),
		);
		const previous = snapshot.get(manifestPath);
		let manifest: Manifest = { format: 1, files: {} };
		if (previous && !previous.deleted) {
			if (!previous.data) throw new Error("notCached");
			const parsed = JSON.parse(await previous.data.text()) as Manifest;
			if (
				parsed.format !== 1 ||
				!parsed.files ||
				typeof parsed.files !== "object" ||
				Array.isArray(parsed.files) ||
				Object.values(parsed.files).some(
					(value) => typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value),
				)
			)
				throw new Error("invalidBackup");
			manifest = parsed;
		}
		const updates = new Map<string, Blob>();
		const entries = { ...manifest.files };
		for (const [path, text] of bundled) {
			const file = snapshot.get(path);
			if (file?.deleted || (file && !file.data)) continue;
			const parents = path.split("/").slice(0, -1);
			if (
				parents.some((_, index) => {
					const parent = snapshot.get(parents.slice(0, index + 1).join("/"));
					return (
						parent && (parent.deleted || parent.mime !== "inode/directory")
					);
				})
			)
				continue;
			const nextHash = await hash(text);
			const currentHash = file?.data
				? await hash(await file.data.text())
				: null;
			if (currentHash === nextHash) {
				entries[path] = nextHash;
				continue;
			}
			if (file && currentHash !== manifest.files[path]) continue;
			updates.set(path, new Blob([text], { type: mimeFor(path) }));
			entries[path] = nextHash;
		}
		const nextManifest = JSON.stringify({ format: 1, files: entries });
		if (
			!previous?.data ||
			previous.deleted ||
			(await previous.data.text()) !== nextManifest
		)
			updates.set(
				manifestPath,
				new Blob([nextManifest], { type: "application/json" }),
			);
		if (!updates.size) return;
		await localTransaction((files) => {
			// Also protect the manifest and unchanged adopted files from concurrent writers.
			for (const path of new Set([...bundled.keys(), manifestPath])) {
				if (files.get(path)?.localId !== snapshot.get(path)?.localId)
					throw new Error("localConflict");
			}
			for (const [path, data] of updates) {
				files.set(path, editedFile(path, data, files.get(path)));
				changed.push(path);
			}
		});
	});
	if (changed.length) filesChanged(changed);
	return changed.filter((path) => path !== manifestPath);
}
