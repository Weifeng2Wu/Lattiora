/** Browser implementation of the workspace subset of Tauri's FS plugin. */
import {
	cloudRelative,
	listLocalFiles,
	mkdirLocal,
	moveLocal,
	readLocalFile,
	removeLocal,
	writeLocalFile,
} from "./files";

type Path = string | URL;
const pathOf = (path: Path) => cloudRelative(String(path));
export type DirEntry = {
	name: string;
	isDirectory: boolean;
	isFile: boolean;
	isSymlink: boolean;
};

export async function readFile(path: Path): Promise<Uint8Array<ArrayBuffer>> {
	return new Uint8Array(
		await (await readLocalFile(pathOf(path))).arrayBuffer(),
	);
}
export async function readTextFile(path: Path): Promise<string> {
	return (await readLocalFile(pathOf(path))).text();
}
export async function writeFile(path: Path, bytes: Uint8Array): Promise<void> {
	await writeLocalFile(pathOf(path), new Blob([bytes.slice().buffer]));
}
export async function writeTextFile(
	path: Path,
	content: string,
): Promise<void> {
	await writeLocalFile(
		pathOf(path),
		new Blob([content], { type: "text/plain;charset=utf-8" }),
	);
}
export async function exists(path: Path): Promise<boolean> {
	const rel = pathOf(path);
	if (!rel) return true;
	return (await listLocalFiles()).some(
		(f) => !f.deleted && (f.path === rel || f.path.startsWith(`${rel}/`)),
	);
}
export async function mkdir(
	path: Path,
	_options?: { recursive?: boolean },
): Promise<void> {
	const rel = pathOf(path);
	if (rel) await mkdirLocal(rel);
}
export async function remove(
	path: Path,
	options?: { recursive?: boolean },
): Promise<void> {
	await removeLocal(pathOf(path), options?.recursive);
}
export async function rename(from: Path, to: Path): Promise<void> {
	await moveLocal(pathOf(from), pathOf(to));
}
export async function copyFile(from: Path, to: Path): Promise<void> {
	await writeLocalFile(pathOf(to), await readLocalFile(pathOf(from)));
}
export async function readDir(path: Path): Promise<DirEntry[]> {
	const rel = pathOf(path);
	const prefix = rel ? `${rel}/` : "";
	const files = (await listLocalFiles()).filter((f) => !f.deleted);
	if (rel && !files.some((f) => f.path === rel || f.path.startsWith(prefix))) {
		throw new Error(`Directory not found: ${rel}`);
	}
	const entries = new Map<string, DirEntry>();
	for (const f of files) {
		if (!f.path.startsWith(prefix)) continue;
		const rest = f.path.slice(prefix.length);
		if (!rest) continue;
		const name = rest.split("/")[0];
		const isDirectory = rest.includes("/") || f.mime === "inode/directory";
		const previous = entries.get(name);
		if (!previous || isDirectory)
			entries.set(name, {
				name,
				isDirectory,
				isFile: !isDirectory,
				isSymlink: false,
			});
	}
	return [...entries.values()].sort((a, b) =>
		a.name.localeCompare(b.name, undefined, { numeric: true }),
	);
}
export async function stat(path: Path) {
	const rel = pathOf(path);
	const file = (await listLocalFiles()).find(
		(f) => !f.deleted && f.path === rel,
	);
	if (!file && !(await exists(path))) throw new Error(`File not found: ${rel}`);
	const isDirectory = !file || file.mime === "inode/directory";
	return {
		isDirectory,
		isFile: !isDirectory,
		isSymlink: false,
		size: file?.size ?? 0,
		mtime: file ? new Date(file.updated_at) : null,
		birthtime: null,
		atime: null,
		readonly: false,
		dev: null,
		ino: null,
		mode: null,
		nlink: null,
		uid: null,
		gid: null,
		rdev: null,
		blksize: null,
		blocks: null,
	};
}
