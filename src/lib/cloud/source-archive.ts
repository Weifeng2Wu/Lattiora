import { validPath } from "./protocol";

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 2000;
export type SourceEntry = { path: string; data: Uint8Array };
const text = (bytes: Uint8Array) =>
	new TextDecoder().decode(bytes).replace(/\0.*$/s, "");
const octal = (bytes: Uint8Array) => {
	const value = text(bytes).trim();
	if (!/^[0-7]*$/.test(value)) throw new Error("invalidSourceArchive");
	return parseInt(value || "0", 8);
};
/** POSIX/GNU tar, regular files only. No archive entry can escape source/. */
export function parseSourceTar(bytes: Uint8Array): SourceEntry[] {
	const entries: SourceEntry[] = [];
	const names = new Set<string>();
	let longName: string | undefined;
	let paxPath: string | undefined;
	let offset = 0;
	while (offset + 512 <= bytes.length) {
		const header = bytes.subarray(offset, offset + 512);
		if (header.every((n) => n === 0)) return entries;
		const checksum = header.reduce(
			(sum, n, i) => sum + (i >= 148 && i < 156 ? 32 : n),
			0,
		);
		if (checksum !== octal(header.subarray(148, 156)))
			throw new Error("invalidSourceArchive");
		const size = octal(header.subarray(124, 136));
		if (size > MAX_BYTES || offset + 512 + size > bytes.length)
			throw new Error("invalidSourceArchive");
		const data = bytes.subarray(offset + 512, offset + 512 + size);
		const kind = String.fromCharCode(header[156] || 48);
		const prefix = text(header.subarray(345, 500));
		let path =
			longName ??
			paxPath ??
			`${prefix ? `${prefix}/` : ""}${text(header.subarray(0, 100))}`;
		offset += 512 + Math.ceil(size / 512) * 512;
		if (kind === "L") {
			longName = text(data);
			continue;
		}
		if (kind === "x" || kind === "g") {
			let position = 0;
			while (position < data.length) {
				const space = data.indexOf(32, position);
				if (space < 0) throw new Error("invalidSourceArchive");
				const length = Number(text(data.subarray(position, space)));
				if (
					!Number.isInteger(length) ||
					length <= space - position + 1 ||
					position + length > data.length
				)
					throw new Error("invalidSourceArchive");
				const record = text(
					data.subarray(space + 1, position + length),
				).replace(/\n$/, "");
				const equal = record.indexOf("=");
				if (record.slice(0, equal) === "path") {
					if (kind === "g") throw new Error("invalidSourceArchive");
					paxPath = record.slice(equal + 1);
				}
				position += length;
			}
			continue;
		}
		longName = undefined;
		paxPath = undefined;
		path = path.replace(/^(\.\/)+/, "");
		if (kind === "5") continue;
		if (kind !== "0") throw new Error("unsupportedSourceArchive");
		if (
			!validPath(path) ||
			path.startsWith("/") ||
			path.includes("\\") ||
			names.has(path)
		)
			throw new Error("invalidSourceArchive");
		names.add(path);
		entries.push({ path, data });
		if (entries.length > MAX_ENTRIES) throw new Error("sourceTooLarge");
	}
	if (offset !== bytes.length || !entries.length)
		throw new Error("invalidSourceArchive");
	return entries;
}
async function bounded(
	stream: ReadableStream<Uint8Array>,
	signal?: AbortSignal,
) {
	const reader = stream.getReader();
	const parts: Uint8Array[] = [];
	let length = 0;
	const cancel = () => {
		void reader.cancel().catch(() => undefined);
	};
	signal?.addEventListener("abort", cancel, { once: true });
	try {
		for (;;) {
			signal?.throwIfAborted();
			const item = await reader.read();
			if (item.done) break;
			length += item.value.length;
			if (length > MAX_BYTES) throw new Error("sourceTooLarge");
			parts.push(item.value);
		}
	} finally {
		signal?.removeEventListener("abort", cancel);
		await reader.cancel().catch(() => undefined);
	}
	signal?.throwIfAborted();
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.length;
	}
	return bytes;
}
export async function unpackArxivSource(
	blob: Blob,
	signal?: AbortSignal,
): Promise<SourceEntry[]> {
	if (blob.size > 32 * 1024 * 1024) throw new Error("sourceTooLarge");
	const header = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
	const gzip = header[0] === 0x1f && header[1] === 0x8b;
	const bytes = await bounded(
		gzip
			? blob.stream().pipeThrough(new DecompressionStream("gzip"))
			: blob.stream(),
		signal,
	);
	const head = text(bytes.subarray(0, 1024));
	if (head.startsWith("%PDF-") || /^\s*<(?:!doctype|html)/i.test(head))
		throw new Error("sourceUnavailable");
	// arXiv also serves gzip-compressed single TeX sources rather than tar archives.
	if (/\\(?:documentclass|documentstyle|begin\{document\})/.test(head))
		return [{ path: "main.tex", data: bytes }];
	const entries = parseSourceTar(bytes);
	if (!entries.some((entry) => /\.(?:tex|ltx)$/i.test(entry.path)))
		throw new Error("sourceUnavailable");
	return entries;
}
