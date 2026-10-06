import { Unzip, UnzipInflate } from "fflate";
import type {
	LayoutRemoteBox,
	LayoutRemotePageResult,
} from "@/lib/pdf/layout/paddle";
import { validPath } from "./protocol";

export type ParserResult = {
	pages: LayoutRemotePageResult[];
	markdown: string;
	assets: Array<{ path: string; data: Uint8Array<ArrayBuffer> }>;
};
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as JsonObject)
		: {};
const array = (value: unknown): unknown[] =>
	Array.isArray(value) ? value : [];
const positive = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: null;
function coordinate(value: unknown): [number, number, number, number] | null {
	return Array.isArray(value) &&
		value.length === 4 &&
		value.every((v) => typeof v === "number" && Number.isFinite(v))
		? (value as [number, number, number, number])
		: null;
}
export function parsePaddleResult(raw: unknown): ParserResult {
	const input = object(raw);
	if (typeof input.jsonl !== "string")
		throw new Error("invalidProviderResponse");
	const pages: LayoutRemotePageResult[] = [];
	const markdown: string[] = [];
	for (const line of input.jsonl.split(/\r?\n/).filter((l) => l.trim())) {
		const row = object(JSON.parse(line));
		const result = object(row.result ?? row);
		const info = object(result.dataInfo ?? input.dataInfo);
		for (const item of array(result.layoutParsingResults)) {
			const page = object(item),
				pruned = object(page.prunedResult);
			const dims = object(array(info.pages)[pages.length]);
			const boxes: LayoutRemoteBox[] = [];
			for (const item of array(object(pruned.layout_det_res).boxes)) {
				const box = object(item),
					rect = coordinate(box.coordinate);
				if (rect && typeof box.label === "string")
					boxes.push({
						clsId: typeof box.cls_id === "number" ? box.cls_id : -1,
						label: box.label,
						score: typeof box.score === "number" ? box.score : 1,
						coordinate: rect,
					});
			}
			pages.push({
				boxes,
				widthPx: positive(dims.width ?? info.width),
				heightPx: positive(dims.height ?? info.height),
			});
			const text =
				typeof page.markdown === "string"
					? page.markdown
					: object(page.markdown).text;
			markdown.push(
				typeof text === "string"
					? text
					: array(pruned.parsing_res_list)
							.map((b) => object(b).block_content)
							.filter((t) => typeof t === "string")
							.join("\n\n"),
			);
		}
	}
	if (!pages.length) throw new Error("invalidProviderResponse");
	return {
		pages,
		markdown: markdown.filter((s) => s.trim()).join("\n\n"),
		assets: [],
	};
}
function readZip(bytes: Uint8Array): Map<string, Uint8Array<ArrayBuffer>> {
	if (bytes.length > 16 * 1024 * 1024) throw new Error("tooLarge");
	const entries = new Map<string, Uint8Array<ArrayBuffer>>();
	let total = 0,
		count = 0,
		error: unknown;
	const unzip = new Unzip((file) => {
		try {
			if (
				++count > 4000 ||
				!validPath(file.name.replace(/\/$/, "")) ||
				(file.originalSize ?? 0) > 16 * 1024 * 1024
			)
				throw new Error("invalidProviderResponse");
			if (file.name.endsWith("/")) return;
			if (entries.has(file.name)) throw new Error("invalidProviderResponse");
			const chunks: Uint8Array[] = [];
			let size = 0;
			file.ondata = (err, data, final) => {
				if (err) {
					error = err;
					return;
				}
				size += data.length;
				total += data.length;
				if (size > 16 * 1024 * 1024 || total > 64 * 1024 * 1024) {
					error = new Error("tooLarge");
					file.terminate();
					return;
				}
				chunks.push(data);
				if (final) {
					const result = new Uint8Array(size);
					let offset = 0;
					for (const chunk of chunks) {
						result.set(chunk, offset);
						offset += chunk.length;
					}
					entries.set(file.name, result);
				}
			};
			file.start();
		} catch (err) {
			error = err;
			file.terminate();
		}
	});
	unzip.register(UnzipInflate);
	for (let offset = 0; offset < bytes.length; offset += 16384) {
		unzip.push(
			bytes.subarray(offset, offset + 16384),
			offset + 16384 >= bytes.length,
		);
		if (error) throw error;
	}
	return entries;
}
const labels: Record<string, string> = {
	title: "paragraph_title",
	image: "image",
	chart: "chart",
	table: "table",
	equation: "formula",
	interline_equation: "formula",
	code: "algorithm",
	algorithm: "algorithm",
	list: "text",
	page_header: "header",
	page_footer: "footer",
	page_footnote: "footnote",
	ref_text: "reference",
};
export function parseMineruResult(bytes: Uint8Array): ParserResult {
	const entries = readZip(bytes);
	const find = (names: string[]) => {
		for (const name of names) {
			const exact = entries.get(name);
			if (exact) return exact;
			const matches = [...entries].filter(([path]) => path.endsWith(name));
			if (matches.length === 1) return matches[0][1];
		}
		return undefined;
	};
	const json = (names: string[]) => {
		const bytes = find(names);
		return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : undefined;
	};
	const middle = object(json(["middle.json", "layout.json"]));
	const pages: LayoutRemotePageResult[] = array(middle.pdf_info).map((p) => {
		const size = array(object(p).page_size);
		return {
			boxes: [],
			widthPx: positive(size[0]),
			heightPx: positive(size[1]),
		};
	});
	for (const raw of array(json(["content_list.json"]))) {
		const item = object(raw),
			bbox = coordinate(item.bbox),
			index = item.page_idx;
		if (
			typeof index !== "number" ||
			!Number.isInteger(index) ||
			!bbox ||
			typeof item.type !== "string"
		)
			continue;
		const page = pages[index];
		if (!page?.widthPx || !page.heightPx) continue;
		const label =
			item.type === "text" && Number(item.text_level) >= 1
				? "paragraph_title"
				: (labels[item.type] ?? item.type);
		page.boxes.push({
			clsId: -1,
			label,
			score: 1,
			coordinate: [
				(bbox[0] / 1000) * page.widthPx,
				(bbox[1] / 1000) * page.heightPx,
				(bbox[2] / 1000) * page.widthPx,
				(bbox[3] / 1000) * page.heightPx,
			],
		});
	}
	const md = find(["full.md"]);
	const markdown = md ? new TextDecoder().decode(md) : "";
	const assets: ParserResult["assets"] = [];
	const used = new Set<string>();
	for (const [path, data] of entries) {
		const match = /(?:^|\/)images\/(.+\.(?:png|jpe?g|webp|gif|svg))$/i.exec(
			path,
		);
		if (!match) continue;
		const rel = `images/${match[1]}`;
		if (used.has(rel)) throw new Error("invalidProviderResponse");
		used.add(rel);
		assets.push({ path: rel, data });
	}
	if (!pages.length && !markdown.trim())
		throw new Error("invalidProviderResponse");
	return { pages, markdown, assets };
}
