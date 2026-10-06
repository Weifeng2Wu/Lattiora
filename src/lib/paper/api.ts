/**
 * Catalog paper list/get helpers (SQLite via Host).
 * Import/export go through Translator `/import` and `/export` (Zotero JSON).
 */

import i18n from "@/i18n";
import { downloadBlob } from "@/lib/cloud/backup";
import { pickFiles } from "@/lib/cloud/import";
import {
	commands,
	type PaperMetaPatch as PaperMetaPatchWire,
	type PaperRecord_Serialize as PaperRecordWire,
	type PaperRescanResult,
	type PaperTag as PaperTagWire,
	type TrashEntry,
	type TrashResult,
} from "@/lib/core/bindings";
import { callApi, callApiResult } from "@/lib/core/ipc";
import { normalizeRelPath } from "@/lib/core/path";
import type {
	PaperLibraryRow,
	PaperMetadata,
	PaperTagInput,
} from "@/lib/paper/types";
import { paperFromWire } from "@/lib/paper/wire";
import { type AppSettings, DEFAULT_TRANSLATOR_BASE_URL } from "@/lib/settings";
import type { WikiRenameResult } from "@/lib/wiki";

/**
 * Virtual file-tree path for the papers library table.
 * Not a real filesystem path — never passed to Host fs APIs.
 */
export const LIBRARY_VIRTUAL_PATH = "agentero:library";

export function isLibraryVirtualPath(path: string | null | undefined): boolean {
	return path === LIBRARY_VIRTUAL_PATH;
}

/** Virtual file-tree / tab path for the Recycle Bin center view. */
export const TRASH_VIRTUAL_PATH = "agentero:trash";

export function isTrashVirtualPath(path: string | null | undefined): boolean {
	return path === TRASH_VIRTUAL_PATH;
}

/** Normalize vault-relative path for library scope comparisons. */
export function normalizeLibraryScope(path: string): string {
	return normalizeRelPath(path).toLowerCase();
}

/**
 * Whether a vault-relative path is a meaningful Library folder scope.
 * Only `papers` / `papers/...` filter the catalog; `notes`, `.agents`,
 * `plans`, etc. are not paper trees and must show the full library (#160).
 */
export function isPapersLibraryScope(
	scopeRel: string | null | undefined,
): boolean {
	if (scopeRel == null || scopeRel === "") return false;
	const s = normalizeLibraryScope(scopeRel);
	return s === "papers" || s.startsWith("papers/");
}

/**
 * Resolve a folder click to a Library scope path.
 * Non-papers folders → `null` (full library).
 */
export function resolveLibraryScopePath(
	rel: string | null | undefined,
): string | null {
	if (rel == null || rel === "") return null;
	const cleaned = rel.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
	if (!cleaned) return null;
	return isPapersLibraryScope(cleaned) ? cleaned : null;
}

/**
 * Destination folder for a PDF dropped on the Library table.
 * Folder-scoped Library (`papers/nlp`) imports there; full library uses
 * `fallback` (tree selection / `papers`).
 */
export function libraryDropParentDir(
	scopePath: string | null | undefined,
	fallback = "papers",
): string {
	const cleaned = (scopePath ?? "")
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "");
	if (!cleaned || !isPapersLibraryScope(cleaned)) {
		return fallback.trim() || "papers";
	}
	return cleaned;
}

/**
 * Whether a catalog paper path falls under a folder scope (recursive).
 * `scopeRel` is vault-relative (e.g. `papers/nlp`); empty/null = full library.
 * Scopes outside `papers/` are treated as full library (#160).
 */
export function paperInLibraryScope(
	paperPath: string | undefined,
	scopeRel: string | null | undefined,
): boolean {
	if (scopeRel == null || scopeRel === "") return true;
	if (!isPapersLibraryScope(scopeRel)) return true;
	if (!paperPath) return false;
	const p = normalizeLibraryScope(paperPath);
	const s = normalizeLibraryScope(scopeRel);
	if (!s) return true;
	return p === s || p.startsWith(`${s}/`);
}

/** Filter catalog rows to those under a vault-relative folder (recursive). */
export function filterPapersByScope<T extends PaperMetadata>(
	papers: T[],
	scopeRel: string | null | undefined,
): T[] {
	if (scopeRel == null || scopeRel === "") return papers;
	if (!isPapersLibraryScope(scopeRel)) return papers;
	const s = normalizeLibraryScope(scopeRel);
	if (!s) return papers;
	return papers.filter((p) => paperInLibraryScope(p.path, s));
}

export async function listPapers(
	vaultPath: string,
): Promise<PaperLibraryRow[]> {
	const { isRemoteVaultHandle, remotePaperList, remoteSessionIdFromHandle } =
		await import("@/lib/vault/remote/remote-vault");
	if (isRemoteVaultHandle(vaultPath)) {
		const sessionId = remoteSessionIdFromHandle(vaultPath);
		if (!sessionId) return [];
		// Remote listings are bare records: nothing probes the remote host for
		// a local PDF, so the row says "unknown" rather than "missing".
		const rows = (await remotePaperList(sessionId)) as PaperRecordWire[];
		return rows.map((row) => ({ ...paperFromWire(row), has_pdf: undefined }));
	}
	const rows = await callApiResult(() => commands.paperList({ vaultPath }), {
		fallback: "paper_list failed",
	});
	return rows.map(paperFromWire);
}

export type { PaperRescanResult };

/** Rebuild catalog rows from papers/ on disk (recover disk-only papers). */
export async function rescanPapers(vaultPath: string): Promise<number> {
	const { isRemoteVaultHandle, remotePaperRescan, remoteSessionIdFromHandle } =
		await import("@/lib/vault/remote/remote-vault");
	if (isRemoteVaultHandle(vaultPath)) {
		const sessionId = remoteSessionIdFromHandle(vaultPath);
		if (!sessionId) return 0;
		const r = await remotePaperRescan(sessionId);
		return r.count;
	}
	const r = await callApi(() => commands.paperRescan({ vaultPath }), {
		fallback: i18n.t("sidebar:papersLibrary.rescanFailed"),
	});
	return r.count;
}

/**
 * Cached PDF page counts keyed by vault-relative paper path (catalog table
 * `pdf_page_counts`). Lets the reading heatmap skip reopening every PDF.
 * Best-effort: cache misses/failures just fall back to reading the PDF.
 */
export async function listPaperPageCounts(
	vaultPath: string,
): Promise<Map<string, number>> {
	const { isRemoteVaultHandle } = await import(
		"@/lib/vault/remote/remote-vault"
	);
	if (isRemoteVaultHandle(vaultPath)) return new Map();
	try {
		const counts = await callApi(
			() => commands.paperPageCounts({ vaultPath }),
			{ fallback: "paper_page_counts failed" },
		);
		return new Map(Object.entries(counts ?? {}));
	} catch {
		return new Map();
	}
}

/** Persist newly discovered PDF page counts (best-effort, fire-and-forget). */
export async function savePaperPageCounts(
	vaultPath: string,
	counts: ReadonlyMap<string, number>,
): Promise<void> {
	if (counts.size === 0) return;
	const { isRemoteVaultHandle } = await import(
		"@/lib/vault/remote/remote-vault"
	);
	if (isRemoteVaultHandle(vaultPath)) return;
	try {
		await callApi(
			() =>
				commands.paperSetPageCounts({
					vaultPath,
					counts: Object.fromEntries(counts),
				}),
			{ fallback: "paper_set_page_counts failed" },
		);
	} catch {
		// Cache write failure is invisible by design; next load retries.
	}
}

export type { TrashResult };

/**
 * Move vault-relative paths into the recycle bin (`.agentero/.trash/`).
 * Snapshots + removes catalog rows so the delete can be undone.
 */
export async function trashPaths(
	vaultPath: string,
	rels: string[],
): Promise<TrashResult> {
	return callApiResult(() => commands.pathTrash({ vaultPath, rels }), {
		fallback: i18n.t("sidebar:fileTree.deleteFailed"),
	});
}

export type { TrashEntry };

/** List all items currently in the recycle bin (`.agentero/.trash/`). */
export async function listTrash(vaultPath: string): Promise<TrashEntry[]> {
	return callApiResult(() => commands.pathListTrash({ vaultPath }), {
		fallback: i18n.t("sidebar:recycleBin.loadFailed"),
	});
}

/** Restore one recycle-bin item to its original path; returns the rel path. */
export async function restoreTrashItem(
	vaultPath: string,
	batchId: string,
	stored: string,
): Promise<string> {
	const r = await callApiResult(
		() => commands.pathRestoreItem({ vaultPath, batchId, stored }),
		{ fallback: i18n.t("sidebar:fileTree.undoFailed") },
	);
	return r.rel;
}

/** Permanently delete one recycle-bin item. */
export async function purgeTrashItem(
	vaultPath: string,
	batchId: string,
	stored: string,
): Promise<void> {
	await callApiResult(
		() => commands.pathPurgeItem({ vaultPath, batchId, stored }),
		{ fallback: i18n.t("sidebar:recycleBin.purgeFailed") },
	);
}

/** Empty the entire recycle bin (permanent). */
export async function purgeAllTrash(vaultPath: string): Promise<void> {
	await callApiResult(() => commands.pathPurgeTrash({ vaultPath }), {
		fallback: i18n.t("sidebar:recycleBin.purgeFailed"),
	});
}

export type PaperMoveResult = {
	newRel: string;
	linkUpdate: WikiRenameResult;
};

/**
 * Move a paper/org folder (or file) into another papers/ folder on disk and
 * rewrite matching catalog path prefixes. Never overwrites an existing target.
 */
export async function movePaperFolder(
	vaultPath: string,
	fromRel: string,
	destParentRel: string,
	dirtyPaths: string[],
): Promise<PaperMoveResult> {
	return callApiResult(
		() => commands.paperMove({ vaultPath, fromRel, destParentRel, dirtyPaths }),
		{ fallback: i18n.t("sidebar:fileTree.moveFailed") },
	);
}

/**
 * Mark paper as read / unread after paper-reader workflow (catalog authority).
 */
export async function setPaperIsRead(
	vaultPath: string,
	path: string,
	isRead: boolean,
): Promise<PaperMetadata> {
	const { isRemoteVaultHandle, remoteSessionIdFromHandle } = await import(
		"@/lib/vault/remote/remote-vault"
	);
	if (isRemoteVaultHandle(vaultPath)) {
		const sessionId = remoteSessionIdFromHandle(vaultPath);
		if (!sessionId) {
			throw new Error(i18n.t("sidebar:fileTree.readMarkFailed"));
		}
		const paper = await callApiResult(
			() => commands.remotePaperSetIsRead({ sessionId, path, isRead }),
			{ fallback: i18n.t("sidebar:fileTree.readMarkFailed") },
		);
		void import("@/lib/activity").then(({ track }) => {
			track("paper.read", { path, extra: { isRead } });
		});
		return paperFromWire(paper);
	}
	const paper = await callApi(
		() => commands.paperSetIsRead({ vaultPath, path, isRead }),
		{ fallback: i18n.t("sidebar:fileTree.readMarkFailed") },
	);
	void import("@/lib/activity").then(({ track }) => {
		track("paper.read", { path, extra: { isRead } });
	});
	return paperFromWire(paper);
}

/**
 * Replace paper tags in catalog (full list; Host normalizes trim/dedupe/color).
 * Items may be bare strings or `{ name, color? }`.
 */
export async function setPaperTags(
	vaultPath: string,
	path: string,
	tags: PaperTagInput[],
): Promise<PaperMetadata> {
	const { isRemoteVaultHandle, remoteSessionIdFromHandle } = await import(
		"@/lib/vault/remote/remote-vault"
	);
	// The Rust deserializer accepts bare strings and `{name,color?}` objects;
	// the generated wire type is the normalized `{name, color}` struct.
	const wireTags: PaperTagWire[] = tags.map((tag) =>
		typeof tag === "string"
			? { name: tag, color: null }
			: { name: tag.name, color: tag.color ?? null },
	);
	if (isRemoteVaultHandle(vaultPath)) {
		const sessionId = remoteSessionIdFromHandle(vaultPath);
		if (!sessionId) {
			throw new Error(i18n.t("sidebar:paperInfo.tagsSaveFailed"));
		}
		const paper = await callApiResult(
			() => commands.remotePaperSetTags({ sessionId, path, tags: wireTags }),
			{ fallback: i18n.t("sidebar:paperInfo.tagsSaveFailed") },
		);
		return paperFromWire(paper);
	}
	const paper = await callApi(
		() => commands.paperSetTags({ vaultPath, path, tags: wireTags }),
		{ fallback: i18n.t("sidebar:paperInfo.tagsSaveFailed") },
	);
	return paperFromWire(paper);
}

/**
 * Manual metadata patch: omitted fields keep current values; empty strings
 * clear the column. Mirrors Host `PaperMetaPatch`.
 */
export type PaperMetaPatch = {
	title?: string;
	authors?: string[];
	date?: string;
	doi?: string;
	arxivId?: string;
	publication?: string;
	volume?: string;
	issue?: string;
	pages?: string;
	publisher?: string;
	abstract?: string;
	pdfUrl?: string;
	htmlUrl?: string;
};

/**
 * Manually edit paper metadata in catalog (patch semantics).
 * Remote vaults are not supported yet.
 */
export async function updatePaperMeta(
	vaultPath: string,
	path: string,
	patch: PaperMetaPatch,
): Promise<PaperMetadata> {
	const { isRemoteVaultHandle } = await import(
		"@/lib/vault/remote/remote-vault"
	);
	if (isRemoteVaultHandle(vaultPath)) {
		throw new Error(i18n.t("sidebar:paperInfo.editMeta.remoteUnsupported"));
	}
	// Wire patch fields are all required and nullable; `null` (Rust `None`)
	// keeps the current value, matching the domain patch's absent fields.
	const wirePatch: PaperMetaPatchWire = {
		title: patch.title ?? null,
		authors: patch.authors ?? null,
		date: patch.date ?? null,
		doi: patch.doi ?? null,
		arxivId: patch.arxivId ?? null,
		publication: patch.publication ?? null,
		volume: patch.volume ?? null,
		issue: patch.issue ?? null,
		pages: patch.pages ?? null,
		publisher: patch.publisher ?? null,
		abstract: patch.abstract ?? null,
		pdfUrl: patch.pdfUrl ?? null,
		htmlUrl: patch.htmlUrl ?? null,
	};
	const paper = await callApi(
		() => commands.paperUpdateMeta({ vaultPath, path, patch: wirePatch }),
		{ fallback: i18n.t("sidebar:paperInfo.editMeta.saveFailed") },
	);
	return paperFromWire(paper);
}

export type PaperExportResult = {
	format: string;
	content: string;
	count: number;
	filename: string;
};

/**
 * Resolve a DOI / arXiv id to metadata without importing. Backs Edit
 * Metadata's identifier refresh.
 */
export async function resolveIdentifierMetadata(
	text: string,
): Promise<PaperMetadata> {
	const { getSettings } = await import("@/lib/settings/react-store");
	const settings: AppSettings = getSettings();
	const record = await callApi(
		() =>
			commands.paperResolveIdentifier({
				text: text.trim(),
				translatorBaseUrl: settings.translatorBaseUrl,
			}),
		{ fallback: i18n.t("sidebar:paperInfo.editMeta.fetchFailed") },
	);
	return paperFromWire(record);
}

export type PaperImportResult = {
	imported: number;
	skipped: number;
	paths: string[];
	titles: string[];
	errors: string[];
};

function translatorBase(settings?: AppSettings): string {
	const raw =
		settings?.translatorBaseUrl?.trim() || DEFAULT_TRANSLATOR_BASE_URL;
	return raw.replace(/\/+$/, "");
}

/**
 * Export catalog via Host → Translator `POST /export`.
 * Host converts catalog rows to a **Zotero API JSON array** (required body shape).
 */
export async function exportLibrary(opts: {
	vaultPath: string;
	settings?: AppSettings;
	/** Default bibtex */
	format?: string;
}): Promise<PaperExportResult> {
	return callApi(
		() =>
			commands.paperExport({
				vaultPath: opts.vaultPath,
				format: opts.format ?? "bibtex",
				translatorBaseUrl: translatorBase(opts.settings),
			}),
		{ fallback: i18n.t("sidebar:papersLibrary.exportFailed") },
	);
}

/**
 * Save-dialog wrapper: export library then write file.
 * Returns null if user cancels the save dialog.
 */
export async function exportLibraryToFile(opts: {
	vaultPath: string;
	settings?: AppSettings;
	format?: string;
}): Promise<PaperExportResult | null> {
	const data = await exportLibrary(opts);
	downloadBlob(new Blob([data.content], { type: "text/plain" }), data.filename);
	return data;
}

/**
 * Import BibTeX/RIS via Translator `POST /import` → catalog + paper folders.
 */
export async function importLibraryText(opts: {
	vaultPath: string;
	content: string;
	parentDir?: string;
	settings?: AppSettings;
}): Promise<PaperImportResult> {
	return callApiResult(
		() =>
			commands.paperImport({
				vaultPath: opts.vaultPath,
				parentDir: opts.parentDir ?? "papers",
				content: opts.content,
				translatorBaseUrl: translatorBase(opts.settings),
			}),
		{ fallback: i18n.t("sidebar:papersLibrary.importFailed") },
	);
}

/**
 * Open-dialog wrapper: pick .bib/.ris/… then import.
 * Returns null if user cancels.
 */
export async function importLibraryFromFile(opts: {
	vaultPath: string;
	parentDir?: string;
	settings?: AppSettings;
}): Promise<PaperImportResult | null> {
	const [selected] = await pickFiles(
		".bib,.ris,.json,.xml,.rdf,.enw,.nbib",
		false,
	);
	if (!selected) return null;
	const content = await selected.text();
	return importLibraryText({
		vaultPath: opts.vaultPath,
		content,
		parentDir: opts.parentDir,
		settings: opts.settings,
	});
}
