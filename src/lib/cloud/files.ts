import { cloudLock, type LocalFile, localTransaction } from "./db";
import { CLOUD_ROOT, MAX_FILE_BYTES, validPath } from "./protocol";

export function cloudRelative(path: string): string {
	const rel =
		path === CLOUD_ROOT
			? ""
			: path.startsWith(`${CLOUD_ROOT}/`)
				? path.slice(CLOUD_ROOT.length + 1)
				: path;
	if (rel && !validPath(rel)) throw new Error("invalidPath");
	return rel;
}
export const absoluteCloudPath = (path: string) =>
	`${CLOUD_ROOT}/${cloudRelative(path)}`;
export const listLocalFiles = () =>
	localTransaction((files) => [...files.values()], false);

let channel: BroadcastChannel | undefined;
export function filesChanged(paths: string[], remote = false) {
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent("cloud:files", { detail: { paths, remote } }),
	);
	channel ??= new BroadcastChannel("agentero-cloud-files");
	channel.postMessage({ paths, remote: true });
}
export function subscribeCloudFiles(
	listener: (paths: string[], remote: boolean) => void,
): () => void {
	channel ??= new BroadcastChannel("agentero-cloud-files");
	const local = (event: Event) => {
		const { paths, remote } = (event as CustomEvent).detail;
		listener(paths, remote);
	};
	const other = (event: MessageEvent) => listener(event.data.paths, true);
	window.addEventListener("cloud:files", local);
	channel.addEventListener("message", other);
	return () => {
		window.removeEventListener("cloud:files", local);
		channel?.removeEventListener("message", other);
	};
}

export function mimeFor(path: string, supplied = ""): string {
	if (supplied === "inode/directory") return supplied;
	const extension = path.split(".").at(-1)?.toLowerCase();
	const known: Record<string, string> = {
		md: "text/markdown",
		txt: "text/plain",
		json: "application/json",
		pdf: "application/pdf",
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		svg: "image/svg+xml",
		webp: "image/webp",
		bib: "text/plain",
		ris: "text/plain",
		tex: "text/plain",
		csv: "text/csv",
		html: "text/html",
		css: "text/css",
		js: "text/javascript",
		ts: "text/plain",
		py: "text/plain",
	};
	return (
		known[extension ?? ""] ??
		(supplied.split(";")[0] || "application/octet-stream")
	);
}
export function editedFile(
	path: string,
	data: Blob | null,
	previous?: LocalFile,
): LocalFile {
	const id = crypto.randomUUID();
	return {
		path,
		version: previous?.version ?? 0,
		seq: previous?.seq ?? 0,
		mutation_id: id,
		deleted: data === null ? 1 : 0,
		mime: data
			? mimeFor(path, data.type)
			: (previous?.mime ?? "application/octet-stream"),
		size: data?.size ?? 0,
		updated_at: Date.now(),
		data,
		dirty: true,
		localId: id,
	};
}

export async function readLocalFile(path: string): Promise<Blob> {
	const rel = cloudRelative(path);
	const file = await localTransaction((files) => files.get(rel), false);
	if (!file || file.deleted) throw new Error(`File not found: ${rel}`);
	if (!file.data) throw new Error("notCached");
	return file.data;
}

export async function writeLocalFile(
	path: string,
	data: Blob,
	options: {
		expectedText?: string | null;
		expectedLocalId?: string | null;
		preserveConflict?: boolean;
	} = {},
): Promise<void> {
	const rel = cloudRelative(path);
	if (!validPath(rel)) throw new Error("invalidPath");
	if (data.size > MAX_FILE_BYTES) throw new Error("tooLarge");
	const changed = [rel];
	await cloudLock("files", async () => {
		let conflict = false;
		if (
			options.expectedText !== undefined ||
			options.expectedLocalId !== undefined
		) {
			const old = await localTransaction((files) => files.get(rel), false);
			conflict =
				options.expectedLocalId !== undefined
					? (old && !old.deleted ? old.localId : null) !==
						options.expectedLocalId
					: options.expectedText === null
						? Boolean(old && !old.deleted)
						: !old ||
							Boolean(old.deleted) ||
							!old.data ||
							(await old.data.text()) !== options.expectedText;
			if (conflict && !options.preserveConflict)
				throw new Error("localConflict");
		}
		await localTransaction((files) => {
			for (
				let parent = rel.slice(0, rel.lastIndexOf("/"));
				rel.includes("/") && parent;
				parent = parent.includes("/")
					? parent.slice(0, parent.lastIndexOf("/"))
					: ""
			) {
				const existing = files.get(parent);
				if (
					existing &&
					!existing.deleted &&
					existing.mime !== "inode/directory"
				)
					throw new Error("pathExists");
			}
			const previous = files.get(rel);
			if (conflict && previous && !previous.deleted && previous.data) {
				const recovery = `Conflicts/editor-${crypto.randomUUID()}/${rel}`;
				files.set(recovery, editedFile(recovery, previous.data));
				changed.push(recovery);
			}
			if (
				previous &&
				!previous.deleted &&
				(previous.mime === "inode/directory") !==
					(data.type === "inode/directory")
			)
				throw new Error("pathExists");
			files.set(rel, editedFile(rel, data, previous));
		});
	});
	filesChanged(changed);
}
export async function mkdirLocal(path: string): Promise<void> {
	const rel = cloudRelative(path);
	const changed = await cloudLock("files", () =>
		localTransaction((files) => {
			const old = files.get(rel);
			if (old && !old.deleted) {
				if (old.mime !== "inode/directory") throw new Error("pathExists");
				return false;
			}
			files.set(
				rel,
				editedFile(rel, new Blob([], { type: "inode/directory" }), old),
			);
			return true;
		}),
	);
	if (changed) filesChanged([rel]);
}

export async function removeLocal(
	path: string,
	recursive = false,
): Promise<void> {
	const rel = cloudRelative(path);
	if (!rel) throw new Error("invalidPath");
	const changed = await cloudLock("files", () =>
		localTransaction((files) => {
			const selected = [...files.values()].filter(
				(f) => !f.deleted && (f.path === rel || f.path.startsWith(`${rel}/`)),
			);
			if (!recursive && selected.some((f) => f.path !== rel))
				throw new Error("directoryNotEmpty");
			for (const f of selected) files.set(f.path, editedFile(f.path, null, f));
			return selected.map((f) => f.path);
		}),
	);
	filesChanged(changed);
}

export async function moveLocal(
	from: string,
	to: string,
	rewrites: Array<{ path: string; before: string; after: string }> = [],
	options: {
		expectedFiles?: Record<string, string>;
		signal?: AbortSignal;
		renameFiles?: Record<string, string>;
	} = {},
): Promise<void> {
	const source = cloudRelative(from);
	const destination = cloudRelative(to);
	if (
		!source ||
		!destination ||
		source === destination ||
		destination.startsWith(`${source}/`)
	)
		throw new Error("invalidPath");
	const changed = await cloudLock("files", async () => {
		// Validate all edited source text before committing the move and link repairs together.
		for (const rewrite of rewrites) {
			const moved =
				rewrite.path === destination ||
				rewrite.path.startsWith(`${destination}/`);
			const previousPath =
				Object.entries(options.renameFiles ?? {}).find(
					([, to]) => to === rewrite.path,
				)?.[0] ??
				(moved
					? source + rewrite.path.slice(destination.length)
					: rewrite.path);
			if ((await (await readLocalFile(previousPath)).text()) !== rewrite.before)
				throw new Error("localConflict");
		}
		return localTransaction((files) => {
			options.signal?.throwIfAborted();
			if (
				Object.entries(options.expectedFiles ?? {}).some(
					([path, id]) => files.get(path)?.localId !== id,
				)
			)
				throw new Error("localConflict");
			const selected = [...files.values()].filter(
				(f) =>
					!f.deleted && (f.path === source || f.path.startsWith(`${source}/`)),
			);
			if (!selected.length) throw new Error("notFound");
			if (
				[...files.values()].some(
					(f) =>
						!f.deleted &&
						(f.path === destination || f.path.startsWith(`${destination}/`)),
				)
			)
				throw new Error("pathExists");
			const paths: string[] = [];
			const destinations = new Set<string>();
			for (const f of selected) {
				if (!f.data) throw new Error("notCached");
				const path =
					options.renameFiles?.[f.path] ??
					destination + f.path.slice(source.length);
				if (
					!validPath(path) ||
					(!path.startsWith(`${destination}/`) && path !== destination)
				)
					throw new Error("invalidPath");
				if (destinations.has(path)) throw new Error("pathExists");
				destinations.add(path);
				files.set(path, editedFile(path, f.data, files.get(path)));
				files.set(f.path, editedFile(f.path, null, f));
				paths.push(path, f.path);
			}
			for (const rewrite of rewrites) {
				files.set(
					rewrite.path,
					editedFile(
						rewrite.path,
						new Blob([rewrite.after], { type: mimeFor(rewrite.path) }),
						files.get(rewrite.path),
					),
				);
				paths.push(rewrite.path);
			}
			return paths;
		});
	});
	filesChanged(changed);
}
