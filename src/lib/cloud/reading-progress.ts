import { z } from "zod";
import { readJsonStorage, writeJsonStorage } from "@/lib/core/storage";
import { cloudLock, type LocalFile, localTransaction } from "./db";
import {
	cloudRelative,
	editedFile,
	filesChanged,
	listLocalFiles,
	writeLocalFile,
} from "./files";

const schema = z.object({
	version: z.literal(1),
	pdfId: z.string(),
	pageCount: z.number().int().min(1).max(100000),
	pages: z.array(z.number().int().positive()).max(100000),
	lastPage: z.number().int().positive(),
	lastReadAt: z.number().finite().nonnegative(),
});
export type ReadingProgress = {
	pages: number[];
	pageCount: number;
	lastPage: number;
	lastReadAt: number;
	analyzedAt?: number;
};
let fallbackDevice: string | undefined;
function deviceId() {
	const stored = readJsonStorage<string>("agentero-reading-device", "");
	if (/^[\da-f-]{36}$/.test(stored)) return stored;
	fallbackDevice ??= crypto.randomUUID();
	writeJsonStorage("agentero-reading-device", fallbackDevice);
	return fallbackDevice;
}

export async function recordReadingPage(
	paper: string,
	page: number,
	pageCount: number,
	at = Date.now(),
) {
	if (
		!Number.isInteger(page) ||
		!Number.isInteger(pageCount) ||
		page < 1 ||
		page > pageCount ||
		pageCount > 100000
	)
		return;
	const rel = cloudRelative(paper);
	if (!rel.startsWith("papers/")) return;
	const path = `${rel}/.reading/${deviceId()}.json`;
	await cloudLock("files", async () => {
		const files = await listLocalFiles();
		const pdf = files.find(
			(file) =>
				!file.deleted &&
				file.path.startsWith(`${rel}/`) &&
				!file.path.startsWith(`${rel}/source/`) &&
				/\.pdf$/i.test(file.path),
		);
		if (
			!pdf ||
			!files.some((file) => file.path === `${rel}/.paper.json` && !file.deleted)
		)
			return;
		const current = files.find((file) => file.path === path && !file.deleted);
		let pages: number[] = [];
		try {
			const old = current?.data
				? schema.parse(JSON.parse(await current.data.text()))
				: null;
			if (old?.pdfId === pdf.mutation_id) pages = old.pages;
		} catch {
			/* A new record replaces invalid derived progress on this device only. */
		}
		const value = schema.parse({
			version: 1,
			pdfId: pdf.mutation_id,
			pageCount,
			pages: [...new Set([...pages.filter((n) => n <= pageCount), page])].sort(
				(a, b) => a - b,
			),
			lastPage: page,
			lastReadAt: at,
		});
		await localTransaction((next) => {
			if (
				next.get(pdf.path)?.mutation_id !== pdf.mutation_id ||
				next.get(pdf.path)?.deleted ||
				next.get(`${rel}/.paper.json`)?.deleted
			)
				return;
			next.set(
				path,
				editedFile(
					path,
					new Blob([JSON.stringify(value)], { type: "application/json" }),
					next.get(path),
				),
			);
		});
	});
	filesChanged([path]);
}

export async function markPaperAnalyzed(paper: string) {
	const rel = cloudRelative(paper);
	await writeLocalFile(
		`${rel}/.reading/analysis.json`,
		new Blob([JSON.stringify({ version: 1, analyzedAt: Date.now() })], {
			type: "application/json",
		}),
	);
}

export async function loadReadingProgress(
	snapshot?: LocalFile[],
): Promise<Map<string, ReadingProgress>> {
	const files = (snapshot ?? (await listLocalFiles())).filter(
		(file) => !file.deleted,
	);
	const papers = files
		.filter(
			(file) =>
				file.path.startsWith("papers/") && file.path.endsWith("/.paper.json"),
		)
		.map((file) => file.path.slice(0, -12));
	const result = new Map<string, ReadingProgress>();
	for (const paper of papers) {
		const pdf = files.find(
			(file) =>
				file.path.startsWith(`${paper}/`) &&
				!file.path.startsWith(`${paper}/source/`) &&
				/\.pdf$/i.test(file.path),
		);
		const value: ReadingProgress = {
			pages: [],
			pageCount: 0,
			lastPage: 1,
			lastReadAt: 0,
		};
		const pages = new Set<number>();
		for (const file of files.filter((file) =>
			file.path.startsWith(`${paper}/.reading/`),
		)) {
			if (!file.data) continue;
			try {
				const raw = JSON.parse(await file.data.text());
				if (file.path.endsWith("/analysis.json")) {
					if (
						raw.version === 1 &&
						Number.isFinite(raw.analyzedAt) &&
						raw.analyzedAt > 0
					)
						value.analyzedAt = raw.analyzedAt;
					continue;
				}
				const record = schema.parse(raw);
				if (!pdf || record.pdfId !== pdf.mutation_id) continue;
				for (const page of record.pages)
					if (page <= record.pageCount) pages.add(page);
				if (record.lastReadAt >= value.lastReadAt) {
					value.lastPage = record.lastPage;
					value.lastReadAt = record.lastReadAt;
					value.pageCount = record.pageCount;
				}
			} catch {
				/* Corrupt progress never fabricates a completed paper. */
			}
		}
		value.pages = [...pages]
			.filter((page) => page <= value.pageCount)
			.sort((a, b) => a - b);
		result.set(paper, value);
	}
	return result;
}
