import type {
	ImportLocalPdfArgs,
	ImportLocalPdfResult_Serialize,
	PaperListRow_Serialize,
	PaperMetaPatch,
	PaperOpenBundle_Serialize,
	PaperRecord_Serialize,
	PaperTag,
} from "@/lib/core/bindings";
import { patchNoteTitle } from "@/lib/paper/note-title";
import { loadSettings } from "@/lib/settings";
import { renderPaperNotes } from "@/lib/vault/note-template";
import { cloudLock, localTransaction } from "./db";
import {
	cloudRelative,
	editedFile,
	filesChanged,
	listLocalFiles,
	mkdirLocal,
	readLocalFile,
	writeLocalFile,
} from "./files";
import { exists, readTextFile } from "./fs";
import { CLOUD_ROOT } from "./protocol";

/** Metadata travels with its paper; concurrent edits of different papers never share a document. */
export const PAPER_META_FILE = ".paper.json";
export type CloudPaper = PaperRecord_Serialize;
export const absoluteCloudPath = (path: string) =>
	`${CLOUD_ROOT}/${cloudRelative(path)}`;
const metadataPath = (path: string) =>
	`${cloudRelative(path)}/${PAPER_META_FILE}`;

export async function savePaper(paper: CloudPaper): Promise<CloudPaper> {
	const next = {
		...paper,
		path: cloudRelative(paper.path),
		updated_at: new Date().toISOString(),
	};
	if (!next.path.startsWith("papers/"))
		throw new Error("Paper paths must be inside papers/");
	await writeLocalFile(
		metadataPath(next.path),
		new Blob([JSON.stringify(next, null, 2)], { type: "application/json" }),
	);
	return next;
}

export async function listCloudPapers(): Promise<PaperListRow_Serialize[]> {
	const files = (await listLocalFiles()).filter((f) => !f.deleted);
	const rows: PaperListRow_Serialize[] = [];
	for (const file of files) {
		if (
			!file.path.startsWith("papers/") ||
			!file.path.endsWith(`/${PAPER_META_FILE}`)
		)
			continue;
		const path = file.path.slice(0, -(PAPER_META_FILE.length + 1));
		const raw: unknown = JSON.parse(await readTextFile(file.path));
		if (!raw || typeof raw !== "object" || !("id" in raw) || !("title" in raw))
			throw new Error(`Invalid paper metadata: ${file.path}`);
		const paper = raw as CloudPaper;
		rows.push({
			...paper,
			path,
			has_pdf: files.some(
				(f) =>
					f.path.startsWith(`${path}/`) &&
					!f.path.startsWith(`${path}/source/`) &&
					/\.pdf$/i.test(f.path),
			),
		});
	}
	return rows.sort((a, b) => b.added_at.localeCompare(a.added_at));
}

export async function getCloudPaper(
	path?: string | null,
	id?: string | null,
): Promise<CloudPaper> {
	if (path) {
		const rel = cloudRelative(path).replace(/\/(NOTES|PAPER)\.md$/i, "");
		const raw = JSON.parse(await readTextFile(metadataPath(rel))) as CloudPaper;
		if (!raw?.id) throw new Error(`Invalid paper metadata: ${rel}`);
		return { ...raw, path: rel };
	}
	const paper = (await listCloudPapers()).find((p) => p.id === id);
	if (!paper) throw new Error(`Paper not found: ${id}`);
	return paper;
}

export function makePaper(
	path: string,
	title: string,
	patch: Partial<CloudPaper> = {},
): CloudPaper {
	const now = new Date().toISOString();
	return {
		id: path.split("/").at(-1) || crypto.randomUUID(),
		type: "other",
		title,
		authors: [],
		tags: [],
		status: "new",
		is_read: false,
		added_at: now,
		updated_at: now,
		...patch,
		path: cloudRelative(path),
	};
}

export async function createCloudPaper(
	title: string,
	parent = "papers",
	patch: Partial<CloudPaper> = {},
): Promise<CloudPaper> {
	const parentRel = cloudRelative(parent);
	if (parentRel !== "papers" && !parentRel.startsWith("papers/"))
		throw new Error("Paper folders must be inside papers/");
	const stem =
		[...(patch.arxiv_id || title)]
			.filter((char) => char.charCodeAt(0) >= 32)
			.join("")
			.normalize("NFKC")
			.replace(/[\\/:*?"<>|]/g, "-")
			.trim()
			.slice(0, 100) || "paper";
	let path = `${parentRel}/${stem}`;
	if (await exists(path)) path += `-${crypto.randomUUID().slice(0, 8)}`;
	await mkdirLocal(path);
	const paper = await savePaper(makePaper(path, title, patch));
	await writeLocalFile(
		`${path}/NOTES.md`,
		new Blob([await renderPaperNotes(paper, loadSettings().paperNoteMode)], {
			type: "text/markdown",
		}),
	);
	return paper;
}

export async function openCloudPaper(
	path: string,
): Promise<PaperOpenBundle_Serialize> {
	const paper = await getCloudPaper(path);
	const files = (await listLocalFiles()).filter(
		(f) => !f.deleted && f.path.startsWith(`${paper.path}/`),
	);
	const pdf = files
		.filter(
			(f) =>
				/\.pdf$/i.test(f.path) && !f.path.startsWith(`${paper.path}/source/`),
		)
		.sort((a, b) => a.path.length - b.path.length)[0];
	return {
		paper,
		pathRel: paper.path,
		notesSeed: (await exists(`${paper.path}/NOTES.md`))
			? await readTextFile(`${paper.path}/NOTES.md`)
			: `# ${paper.title}\n\n`,
		pdfPath: pdf ? absoluteCloudPath(pdf.path) : null,
		hasTex: files.some((f) => /\.(tex|ltx)$/i.test(f.path)),
		hasPaperMd: files.some((f) => f.path === `${paper.path}/PAPER.md`),
	};
}

export async function updateCloudPaper(
	path: string,
	patch: Partial<PaperMetaPatch> & { tags?: PaperTag[]; is_read?: boolean },
	options: {
		expectedLocalId?: string;
		expectedFiles?: Record<string, string>;
		metaSource?: string | null;
		signal?: AbortSignal;
	} = {},
): Promise<CloudPaper> {
	return cloudLock("paper-meta", async () => {
		const rel = cloudRelative(path),
			target = metadataPath(rel),
			notesPath = `${rel}/NOTES.md`;
		const snapshot = await listLocalFiles();
		const file = snapshot.find((f) => f.path === target && !f.deleted);
		if (!file?.data) throw new Error("paperNotFound");
		if (options.expectedLocalId && file.localId !== options.expectedLocalId)
			throw new Error("metadataChanged");
		const paper = {
			...JSON.parse(await file.data.text()),
			path: rel,
		} as CloudPaper;
		const names: Record<string, string> = {
			arxivId: "arxiv_id",
			pdfUrl: "pdf_url",
			htmlUrl: "html_url",
		};
		const updates: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(patch)) {
			if (value != null)
				updates[names[key] || key] =
					typeof value === "string" ? value.trim() : value;
		}
		if (patch.date != null)
			updates.year = Number.parseInt(patch.date, 10) || null;
		const next: CloudPaper = {
			...paper,
			...updates,
			meta_source:
				options.metaSource === null
					? paper.meta_source
					: (options.metaSource ?? "manual"),
			updated_at: new Date().toISOString(),
		};
		const notes = snapshot.find((f) => f.path === notesPath && !f.deleted);
		const beforeNotes = notes?.data ? await notes.data.text() : null;
		const afterNotes =
			beforeNotes !== null && next.title !== paper.title
				? patchNoteTitle(beforeNotes, paper.title, next.title)
				: beforeNotes;
		const changed = [target];
		await cloudLock("files", () =>
			localTransaction((files) => {
				options.signal?.throwIfAborted();
				if (
					Object.entries(options.expectedFiles ?? {}).some(
						([path, id]) => files.get(path)?.localId !== id,
					) ||
					files.get(target)?.localId !== file.localId ||
					files.get(notesPath)?.localId !==
						snapshot.find((f) => f.path === notesPath)?.localId
				)
					throw new Error("metadataChanged");
				files.set(
					target,
					editedFile(
						target,
						new Blob([JSON.stringify(next, null, 2)], {
							type: "application/json",
						}),
						files.get(target),
					),
				);
				if (afterNotes !== beforeNotes && afterNotes !== null) {
					files.set(
						notesPath,
						editedFile(
							notesPath,
							new Blob([afterNotes], { type: "text/markdown" }),
							files.get(notesPath),
						),
					);
					changed.push(notesPath);
				}
			}),
		);
		filesChanged(changed);
		return next;
	});
}

export async function setCloudPaperTags(
	path: string,
	tags: PaperTag[],
): Promise<CloudPaper> {
	const normalized = [
		...new Map(
			tags
				.filter((tag) => tag.name.trim())
				.map((tag) => [
					tag.name.trim(),
					{ name: tag.name.trim(), color: tag.color || null },
				]),
		).values(),
	];
	return updateCloudPaper(path, { tags: normalized }, { metaSource: null });
}

export async function importCloudPdfs(
	args: ImportLocalPdfArgs,
): Promise<ImportLocalPdfResult_Serialize> {
	const entries: NonNullable<ImportLocalPdfArgs["entries"]> = args.entries
		?.length
		? args.entries
		: (args.filePaths || []).map((filePath) => ({ filePath }));
	const result: ImportLocalPdfResult_Serialize = { papers: [], errors: [] };
	for (const entry of entries) {
		try {
			const blob = await readLocalFile(entry.filePath);
			if (!(await blob.slice(0, 1024).text()).includes("%PDF-"))
				throw new Error("The selected file is not a PDF");
			const title =
				entry.title ||
				entry.filePath
					.split("/")
					.at(-1)
					?.replace(/\.pdf$/i, "") ||
				"Paper";
			const paper = await createCloudPaper(title, args.parentDir, {
				type: "pdf",
				authors: entry.authors || [],
				year: entry.year,
				doi: entry.doi,
				arxiv_id: entry.arxivId,
				...entry.extra,
			});
			await writeLocalFile(
				`${paper.path}/paper.pdf`,
				new Blob([blob], { type: "application/pdf" }),
			);
			const { enqueuePdfRecognition } = await import("./recognition");
			await enqueuePdfRecognition(paper, blob);
			result.papers.push({
				paperDir: absoluteCloudPath(paper.path),
				path: paper.path,
				id: paper.id,
				title: paper.title,
				usedTranslator: false,
				translatorBaseUrl: "",
				pdf: true,
				tex: false,
				paperMd: false,
				assetMessages: [],
				status: "created",
				recognizePending: true,
			});
		} catch (error) {
			result.errors.push(
				`${entry.filePath}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	return result;
}

/** Recover metadata for imported paper folders without overwriting existing catalog records. */
export async function rescanCloudPapers(): Promise<{ count: number }> {
	const files = (await listLocalFiles()).filter(
		(f) => !f.deleted && f.path.startsWith("papers/"),
	);
	const candidates = new Set(
		files
			.filter((f) => /\/(NOTES|PAPER)\.md$|\.pdf$/i.test(f.path))
			.map((f) => f.path.slice(0, f.path.lastIndexOf("/"))),
	);
	const roots = files
		.filter((f) => f.path.endsWith("/.paper.json"))
		.map((f) => f.path.slice(0, -"/.paper.json".length));
	let count = 0;
	for (const path of [...candidates].sort((a, b) => a.length - b.length)) {
		if (
			path === "papers" ||
			/(?:^|\/)source(?:\/|$)/.test(path) ||
			roots.some((root) => path.startsWith(`${root}/`)) ||
			(await exists(metadataPath(path)))
		)
			continue;
		await savePaper(
			makePaper(path, path.split("/").at(-1) || "Paper", { type: "pdf" }),
		);
		roots.push(path);
		count++;
	}
	return { count };
}
