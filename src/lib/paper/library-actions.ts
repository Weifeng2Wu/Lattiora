import { paperFromWire } from "@/lib/paper/wire";
/**
 * Library actions: rescan, bibliography import/export, asset downloads, the
 * paper-reader workflow, and tag persistence. Long operations surface in the
 * background-tasks panel.
 */

import i18n from "@/i18n";
import { track } from "@/lib/activity";
import { cloudAiError } from "@/lib/cloud/ai";
import { errorText } from "@/lib/core/error";
import { logger } from "@/lib/core/logger";
import { notifyError, notifySuccess, notifyWarning } from "@/lib/core/notify";
import { runLocalActivity } from "@/lib/core/tasks";
import {
	detectPaperDirectory,
	isPublicationDateInput,
	notesPathForPaper,
	type PaperMetadata,
	type PaperTag,
	paperCatalogPath,
	paperDirFromPath,
	publicationDateText,
	resolvePapersParentDir,
} from "@/lib/paper";
import {
	type PaperMetaPatch,
	rescanPapers,
	setPaperTags,
	updatePaperMeta,
} from "@/lib/paper/api";
import {
	libraryStore,
	refreshLibrary,
	scheduleLibraryRefresh,
	setCitingScanDraft,
	setEditMetaDraft,
	setLibraryIoBusy,
	setLibraryPapers,
	setLibraryRescanning,
} from "@/lib/paper/library-store";
import {
	maybeAutoRunPaperReader,
	paperAssetsReadyForReader,
} from "@/lib/paper/reader";
import type { FileNode } from "@/lib/vault";
import { joinVaultPath, readVaultFile } from "@/lib/vault";
import { isRemoteVaultHandle } from "@/lib/vault/remote/remote-vault";
import { getVaultPath, refreshTree, vaultStore } from "@/lib/vault/store";
import { toVaultRelative } from "@/lib/wiki";
import { openPaper, syncUpdatedPaperTabs } from "@/lib/workspace/actions";
import {
	refreshTabNotes,
	setTabs,
	workspaceStore,
} from "@/lib/workspace/store";

/** Import target directory derived from the current tree selection. */
export function currentLookupParentDir(): string {
	const { vaultPath, treeSelectedPath, tree } = vaultStore.getState();
	return resolvePapersParentDir(vaultPath, treeSelectedPath, tree);
}

/** Open the metadata edit dialog for the paper folder right-clicked in the tree. */
export function editPaperMetaFromTree(paperDir: string): void {
	const vaultPath = getVaultPath();
	if (!vaultPath || isRemoteVaultHandle(vaultPath)) return;
	const rel = toVaultRelative(vaultPath, paperDir);
	const meta = rel
		? libraryStore.getState().paperMetaByRelPath.get(rel)
		: undefined;
	if (meta) setEditMetaDraft(meta);
}

/**
 * Find new papers that cite this library but are not imported yet, and open
 * the candidate list. Online-only and slow enough to need the task panel:
 * runs as a cancellable browser activity with a synchronized result cache.
 */
export async function discoverCitingPapers(): Promise<void> {
	const vaultPath = getVaultPath();
	if (!vaultPath || libraryStore.getState().ioBusy) return;
	setLibraryIoBusy("citing");
	try {
		const { libraryCitingScan } = await import("@/lib/paper/refs");
		const result = await libraryCitingScan(vaultPath);
		setCitingScanDraft(result);
		for (const message of result.messages)
			notifyWarning(cloudAiError(new Error(message)));
	} catch (e) {
		notifyError(cloudAiError(e));
	} finally {
		setLibraryIoBusy(null);
	}
}

/** Rebuild the catalog from papers/ on disk (recover disk-only papers). */
export async function rescanLibraryPapers(): Promise<void> {
	const vaultPath = getVaultPath();
	if (!vaultPath || libraryStore.getState().rescanning) return;
	setLibraryRescanning(true);
	try {
		const n = await rescanPapers(vaultPath);
		await refreshLibrary();
		await refreshTree(vaultPath);
		if (n > 0) {
			notifySuccess(i18n.t("sidebar:papersLibrary.rescanned", { count: n }));
		} else {
			notifyWarning(i18n.t("sidebar:papersLibrary.rescanEmpty"));
		}
	} catch (e) {
		notifyError(
			e instanceof Error
				? e.message
				: i18n.t("sidebar:papersLibrary.rescanFailed"),
		);
	} finally {
		setLibraryRescanning(false);
	}
}

export async function libraryExport(): Promise<void> {
	try {
		const { downloadBibliography } = await import("@/lib/cloud/import");
		await downloadBibliography();
	} catch (error) {
		notifyError(errorText(error));
	}
	return;
}

export async function libraryImport(): Promise<void> {
	try {
		const { pickAndImportBibliography } = await import("@/lib/cloud/import");
		await pickAndImportBibliography();
	} catch (error) {
		notifyError(errorText(error));
	}
	return;
}

/**
 * Shared download core: one `downloadAssets` JobCenter job per paper. The Host
 * runner downloads, invalidates caps, backfills PAPER.md and enqueues the
 * layout pass; byte progress projects into the tasks panel. Returns the
 * post-download asset flags for follow-up workflows (reader).
 */
async function runPaperAssetsDownload(vaultPath: string, rel: string) {
	const { downloadCloudAssets } = await import("@/lib/cloud/paper-assets");
	return runLocalActivity(
		{
			kind: "downloadAssets",
			title: i18n.t("app:tasks.downloadPaper"),
			detail: rel,
		},
		async ({ signal }) => {
			const assets = await downloadCloudAssets(rel, signal);
			await refreshLibrary();
			await refreshTree(vaultPath);
			for (const error of assets.errors)
				notifyError(cloudAiError(new Error(error)));
			if (assets.errors.length && !assets.pdf && !assets.tex && !assets.paperMd)
				throw new Error(assets.errors[0]);
			return assets;
		},
		{ concurrency: 2 },
	);
}

/**
 * On-demand assets: missing local PDF, and/or arXiv TeX when fetchable but
 * absent. Auto-runs the paper reader afterwards when everything is ready.
 */
export async function downloadPaperAssetsAction(node: FileNode): Promise<void> {
	const vaultPath = getVaultPath();
	if (!vaultPath) return;
	const rel = toVaultRelative(vaultPath, node.path)
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "");
	try {
		const assets = await runPaperAssetsDownload(vaultPath, rel);
		// After PDF/TeX/PAPER.md ready → auto paper-reader with task progress.
		if (
			paperAssetsReadyForReader({
				pdf: assets.pdf,
				tex: assets.tex,
				paperMd: assets.paperMd,
			})
		) {
			// Fire-and-forget: reader progress shows in the task bar. Do NOT
			// await — awaiting keeps every paper row busy during reading.
			void maybeAutoRunPaperReader({
				vaultRoot: vaultPath,
				paperPath: rel,
				assetsReady: true,
			})
				.then(async (started) => {
					if (!started) return;
					await refreshLibrary();
					const notesAbs = notesPathForPaper(node.path);
					try {
						const content = await readVaultFile(notesAbs);
						refreshTabNotes(node.path, content);
					} catch {
						// ignore
					}
				})
				.catch((e) => {
					notifyError(errorText(e));
				});
		}
	} catch (e) {
		notifyError(errorText(e));
	}
}

/**
 * Library-table row action: re-download assets (PDF / TeX) from the paper's
 * upstream source — the row for papers synced without bulky attachments.
 */
export async function downloadLibraryPaper(
	paper: PaperMetadata,
): Promise<void> {
	const vaultPath = getVaultPath();
	if (!vaultPath || !paper.path) return;
	const rel = paper.path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
	try {
		await runPaperAssetsDownload(vaultPath, rel);
	} catch (e) {
		notifyError(errorText(e));
	}
}

/**
 * paper-reader workflow: manual read on complete + unread papers.
 * Progress surfaces in the bottom-left background tasks panel.
 */
export async function readPaper(node: FileNode): Promise<void> {
	{
		const { broadcastAgentAttachContext } = await import(
			"@/lib/agent/context-attach"
		);
		const { setPendingAgentComposerPrompt } = await import(
			"@/lib/agent/composer-seed"
		);
		const { openRightTab } = await import("@/lib/shell/ui-window-actions");
		broadcastAgentAttachContext([node.path]);
		setPendingAgentComposerPrompt(i18n.t("cloud:chat.summaryPrompt"));
		openRightTab("agent");
		return;
	}
}

/**
 * Library bulk download: every paper folder missing PDF and/or fetchable TeX.
 * Enqueues one `DownloadAssets` JobCenter job per paper (idle lane); the
 * scheduler throttles (cap 3), each job projects into the tasks panel and
 * backfills PAPER.md + layout, and the library refreshes via the job-completion
 * hook (§10.2).
 */
export async function downloadAllMissingAssets(): Promise<void> {
	const vaultPath = getVaultPath();
	if (!vaultPath) return;
	try {
		const { listCloudPapers } = await import("@/lib/cloud/catalog");
		const { listLocalFiles } = await import("@/lib/cloud/files");
		const files = (await listLocalFiles()).filter((f) => !f.deleted);
		const papers = await listCloudPapers();
		const pending = papers.filter((p) => {
			const own = files.filter((f) => f.path.startsWith(`${p.path}/`));
			return (
				(!own.some(
					(f) =>
						/\.pdf$/i.test(f.path) && !f.path.startsWith(`${p.path}/source/`),
				) &&
					Boolean(p.pdf_url || p.arxiv_id)) ||
				(Boolean(p.arxiv_id) && !own.some((f) => /\.(tex|ltx)$/i.test(f.path)))
			);
		});
		await Promise.allSettled(
			pending.map((p) => runPaperAssetsDownload(vaultPath, p.path)),
		);
	} catch (error) {
		notifyError(cloudAiError(error));
	}
}

export function openLibraryPaper(paper: PaperMetadata): void {
	const vaultPath = getVaultPath();
	if (!vaultPath || !paper.path) return;
	openPaper(joinVaultPath(vaultPath, paper.path));
}

/**
 * Vault-relative catalog path for a paper, or `""` when it cannot be resolved.
 * Prefers `meta.path`; projections may omit it, so fall back to the folder of
 * the tab that has this paper open.
 */
export async function resolvePaperCatalogRel(
	paperMeta: PaperMetadata,
): Promise<string> {
	const vaultPath = getVaultPath();
	if (!vaultPath) return "";
	const path = (paperMeta.path ?? "")
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "");
	if (path) return path;
	const matchingTab = workspaceStore
		.getState()
		.tabs.find((tab) => tab.paperMeta?.id === paperMeta.id);
	const selectedPath = matchingTab?.path ?? null;
	if (!selectedPath) return "";
	let paperDir = paperDirFromPath(
		selectedPath,
		vaultStore.getState().paperFolders,
	);
	if (!paperDir && (await detectPaperDirectory(selectedPath))) {
		paperDir = selectedPath.replace(/[\\/]+$/, "");
	}
	return paperCatalogPath(paperDir ?? "", vaultPath) ?? "";
}

/** Persist Paper Info tags for the displayed paper and sync library + open tabs. */
export async function paperTagsChange(
	paperMeta: PaperMetadata,
	tags: PaperTag[],
): Promise<PaperMetadata | null> {
	const vaultPath = getVaultPath();
	if (!vaultPath) return null;
	const path = await resolvePaperCatalogRel(paperMeta);
	if (!path) {
		notifyError(i18n.t("sidebar:paperInfo.tagsSaveFailed"));
		return null;
	}
	try {
		const updated = await setPaperTags(vaultPath, path, tags);
		track("paper.tag", {
			path,
			extra: { op: "set", tagCount: tags.length },
		});
		setLibraryPapers((prev) =>
			prev.map((p) => {
				const key = p.path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
				return key === path ? { ...p, ...updated } : p;
			}),
		);
		setTabs((prev) =>
			prev.map((tab) => {
				if (!tab.paperMeta) return tab;
				const key = tab.paperMeta.path
					.replace(/\\/g, "/")
					.replace(/^\/+|\/+$/g, "");
				const samePath = key === path;
				const sameOpenPaper = !key && tab.paperMeta.id === paperMeta.id;
				if (!samePath && !sameOpenPaper) return tab;
				return {
					...tab,
					paperMeta: {
						...tab.paperMeta,
						...updated,
					},
				};
			}),
		);
		return { ...paperMeta, ...updated };
	} catch (e) {
		notifyError(errorText(e));
		return null;
	}
}

/** Apply a manual metadata patch and sync library + open tabs. */
export async function paperMetaChange(
	paperMeta: PaperMetadata,
	patch: PaperMetaPatch,
): Promise<PaperMetadata | null> {
	const vaultPath = getVaultPath();
	if (!vaultPath) return null;
	const path = await resolvePaperCatalogRel(paperMeta);
	if (!path) {
		notifyError(i18n.t("sidebar:paperInfo.editMeta.saveFailed"));
		return null;
	}
	try {
		const updated = await updatePaperMeta(vaultPath, path, patch);
		track("paper.edit-meta", {
			path,
			extra: { fields: Object.keys(patch) },
		});
		setLibraryPapers((prev) =>
			prev.map((p) => {
				const key = p.path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
				return key === path ? { ...p, ...updated } : p;
			}),
		);
		syncUpdatedPaperTabs(vaultPath, path, updated, paperMeta.id);
		return { ...paperMeta, ...updated };
	} catch (e) {
		notifyError(errorText(e));
		return null;
	}
}

/**
 * Re-resolve external metadata for the given papers and overwrite catalog fields
 * where the provider returned a non-empty value (library header refresh button).
 * Runs as one browser activity with per-item progress and cancellation.
 * Lookups snapshot local versions and partial failures retain successful updates.
 */
export async function refreshLibraryMetadata(
	vaultPath: string | null | undefined,
	targets: PaperMetadata[],
): Promise<void> {
	if (!vaultPath || isRemoteVaultHandle(vaultPath)) return;
	const papers = targets
		.map((p) => ({
			path: p.path ?? "",
			query: p.doi?.trim() || p.arxiv_id?.trim() || p.title?.trim() || "",
		}))
		.filter((p) => p.path && p.query);
	if (papers.length === 0) {
		notifyError(i18n.t("sidebar:papersLibrary.refreshMetadataNoTargets"));
		return;
	}
	try {
		await runLocalActivity(
			{
				kind: "metadataRefresh",
				title: i18n.t("sidebar:papersLibrary.refreshMetadata"),
			},
			async ({ signal, setProgress, setDetail }) => {
				let failures = 0;
				for (let i = 0; i < papers.length; i++) {
					signal.throwIfAborted();
					setDetail(papers[i].path);
					try {
						const updated = await refreshOnePaperMetadata(
							papers[i].path,
							papers[i].query,
							signal,
						);
						syncUpdatedPaperTabs(
							vaultPath,
							papers[i].path,
							updated,
							updated.id,
						);
					} catch (error) {
						signal.throwIfAborted();
						failures++;
						logger.warn("metadata refresh failed", {
							path: papers[i].path,
							error: errorText(error),
						});
					}
					setProgress((100 * (i + 1)) / papers.length);
				}
				await refreshLibrary();
				await refreshTree(vaultPath);
				if (failures) throw new Error("metadataRefreshPartial");
			},
		);
		notifySuccess(i18n.t("sidebar:papersLibrary.refreshMetadataDone"));
	} catch (error) {
		notifyError(cloudAiError(error));
	}
}

/**
 * Catalog patch from an identifier-resolved record. Empty fields are skipped
 * so `paper_update_meta` keeps the stored value.
 */
export function resolvedMetaPatch(meta: PaperMetadata): PaperMetaPatch {
	const patch: PaperMetaPatch = {};
	if (meta.title?.trim()) patch.title = meta.title.trim();
	if (meta.authors?.length) patch.authors = meta.authors;
	// Sources occasionally return prose ("Spring 2017"); the Host would reject it.
	const date = publicationDateText(meta);
	if (date && isPublicationDateInput(date)) patch.date = date;
	if (meta.doi?.trim()) patch.doi = meta.doi.trim();
	if (meta.arxiv_id?.trim()) patch.arxivId = meta.arxiv_id.trim();
	if (meta.publication?.trim()) patch.publication = meta.publication.trim();
	if (meta.volume?.trim()) patch.volume = meta.volume.trim();
	if (meta.issue?.trim()) patch.issue = meta.issue.trim();
	if (meta.pages?.trim()) patch.pages = meta.pages.trim();
	if (meta.publisher?.trim()) patch.publisher = meta.publisher.trim();
	if (meta.abstract?.trim()) patch.abstract = meta.abstract.trim();
	if (meta.pdf_url?.trim()) patch.pdfUrl = meta.pdf_url.trim();
	if (meta.html_url?.trim()) patch.htmlUrl = meta.html_url.trim();
	return patch;
}

/**
 * Re-resolve external metadata for a single paper. Used by the row context menu.
 */
export async function refreshPaperMetadata(
	vaultPath: string | null | undefined,
	paper: PaperMetadata,
): Promise<void> {
	if (!vaultPath || isRemoteVaultHandle(vaultPath)) return;
	if (!paper.path) return;
	const text =
		paper.doi?.trim() || paper.arxiv_id?.trim() || paper.title?.trim();
	if (!text) {
		notifyError(i18n.t("sidebar:papersLibrary.refreshMetadataNoTargets"));
		return;
	}
	try {
		const updated = await runLocalActivity(
			{
				kind: "metadataRefresh",
				title: i18n.t("sidebar:papersLibrary.refreshMetadata"),
				detail: paper.path,
			},
			({ signal }) =>
				refreshOnePaperMetadata(paper.path as string, text, signal),
		);
		syncUpdatedPaperTabs(vaultPath, paper.path, updated, paper.id);
		scheduleLibraryRefresh();
		notifySuccess(i18n.t("sidebar:papersLibrary.refreshMetadataDone"));
	} catch (error) {
		notifyError(cloudAiError(error));
	}
}

/** Snapshot before the lookup so a concurrent user edit cannot be overwritten. */
async function refreshOnePaperMetadata(
	path: string,
	query: string,
	signal: AbortSignal,
) {
	const { getCloudPaper, updateCloudPaper } = await import(
		"@/lib/cloud/catalog"
	);
	const { listLocalFiles, cloudRelative } = await import("@/lib/cloud/files");
	const { lookupCloudPaper } = await import("@/lib/cloud/research");
	const rel = cloudRelative(path);
	const before = (await listLocalFiles()).find(
		(f) => f.path === `${rel}/.paper.json` && !f.deleted,
	);
	if (!before) throw new Error("paperNotFound");
	const paper = await getCloudPaper(rel);
	const result = await lookupCloudPaper(query, signal);
	if (!result.exact || result.papers.length !== 1)
		throw new Error("metadataAmbiguous");
	return paperFromWire(
		await updateCloudPaper(
			rel,
			resolvedMetaPatch(paperFromWire({ ...paper, ...result.papers[0] })),
			{ expectedLocalId: before.localId, signal },
		),
	);
}
