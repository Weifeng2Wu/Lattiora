/**
 * Paper import actions: magic-wand identifier lookup, Skill install and
 * local-PDF import. Browser activities retain the original progress/cancel UI;
 * files and durable recognition use the cloud storage boundary.
 */

import i18n from "@/i18n";
import { track } from "@/lib/activity";
import { cloudAiError } from "@/lib/cloud/ai";
import {
	discardCloudSkillDiscovery,
	discoverCloudSkills,
	installCloudSkills,
} from "@/lib/cloud/skill-import";
import { parseSkillSource } from "@/lib/cloud/skill-source";
import {
	cancelBackgroundTask,
	isBackgroundTaskCancelledError,
} from "@/lib/core/background-tasks";
import { errorText } from "@/lib/core/error";
import { notifyError, notifySuccess, notifyWarning } from "@/lib/core/notify";
import { runLocalActivity } from "@/lib/core/tasks";
import { currentLookupParentDir } from "@/lib/paper/library-actions";
import {
	libraryStore,
	refreshLibrary,
	setCitingScanDraft,
} from "@/lib/paper/library-store";
import {
	type LocalPdfImportEntry,
	type LookupBatchAddResult,
	looksLikeTitleSearchQuery,
	type PaperSearchCandidate,
	type SkillImportResult,
} from "@/lib/paper/lookup";
import { getSettings } from "@/lib/settings/react-store";
import {
	cleanupImportTempPaths,
	normalizeDroppedPath,
} from "@/lib/shell/external-file-drop";
import {
	addPaperSearchDraft,
	bumpLookupOpenSignal,
	clearPaperSearchDraft,
	layout,
	setSkillImportDraft,
	shiftPaperSearchDraft,
	uiStore,
} from "@/lib/shell/ui-store";
import { joinVaultPath } from "@/lib/vault";
import { getVaultPath, refreshTree } from "@/lib/vault/store";

/** ⇧⌘I — expand the left rail (popover owns focus) and open the wand. */
export function openMagicWand(): void {
	if (!getVaultPath()) {
		notifyError(i18n.t("sidebar:lookup.needsVault"));
		return;
	}
	if (uiStore.getState().sidebarCollapsed) {
		layout()?.setLeftCollapsed(false);
	}
	bumpLookupOpenSignal();
}

export type LookupSubmitOptions = {
	/** Vault-relative destination, e.g. `papers` or `papers/nlp`. Defaults to the current tree selection. */
	parentDir?: string;
	/** Run after one input has finished importing (store refresh is debounced via paper:imported). */
	onComplete?: (result: LookupBatchAddResult) => void | Promise<void>;
};

/** In-flight title-search jobs; closing the picker card cancels them. */
const pendingSearchJobIds = new Set<string>();

type LocalPdfDropRequest = {
	vaultPath: string;
	entries: LocalPdfImportEntry[];
	parentDir: string;
};

/** Preserve rapid consecutive drops instead of discarding them while busy. */
const localPdfDropQueue: LocalPdfDropRequest[] = [];
let localPdfDropRunning = false;
let localPdfDropIdleUnsubscribe: (() => void) | null = null;

function drainLocalPdfDropQueue(): void {
	if (localPdfDropRunning || localPdfDropQueue.length === 0) return;
	if (libraryStore.getState().ioBusy) {
		if (localPdfDropIdleUnsubscribe) return;
		const unsubscribe = libraryStore.subscribe((state) => {
			if (state.ioBusy) return;
			localPdfDropIdleUnsubscribe = null;
			unsubscribe();
			drainLocalPdfDropQueue();
		});
		localPdfDropIdleUnsubscribe = unsubscribe;
		return;
	}

	localPdfDropRunning = true;
	void (async () => {
		try {
			while (localPdfDropQueue.length > 0) {
				const request = localPdfDropQueue.shift();
				if (!request) break;
				await importLocalPdf(request);
			}
		} finally {
			localPdfDropRunning = false;
			drainLocalPdfDropQueue();
		}
	})();
}

export async function lookupSubmit(
	texts: string[],
	opts: LookupSubmitOptions = {},
): Promise<void> {
	const vaultPath = getVaultPath();
	if (!vaultPath) {
		throw new Error(i18n.t("sidebar:lookup.needsVault"));
	}
	if (texts.length === 0) return;
	const parentDir = opts.parentDir ?? currentLookupParentDir();

	{
		const { lookupCloudPaper, importCloudIdentifier } = await import(
			"@/lib/cloud/research"
		);
		const process = async (query: string) => {
			if (parseSkillSource(query)) {
				const discovery = await runLocalActivity(
					{ kind: "skillImport", title: i18n.t("app:tasks.skillLookup") },
					async (ctx) => {
						try {
							return await discoverCloudSkills(query, ctx.signal);
						} catch (e) {
							throw new Error(skillImportError(e));
						}
					},
					{ concurrency: 1 },
				);
				setSkillImportDraft([
					...(uiStore.getState().skillImportDraft ?? []),
					discovery,
				]);
				return;
			}
			let taskId: string | undefined;
			await runLocalActivity(
				{
					kind: "import",
					title: i18n.t("app:tasks.lookupFetching"),
					detail: query,
				},
				async ({ signal, setDetail }) => {
					const result = await lookupCloudPaper(query, signal);
					if (result.exact) {
						const { paper, alreadyInLibrary } = await importCloudIdentifier(
							query,
							parentDir,
							result.papers[0],
							signal,
						);
						setDetail(paper.title);
						if (!alreadyInLibrary)
							track("paper.import", {
								path: paper.path,
								extra: { source: inferLookupSource(query) },
							});
						await refreshLibrary();
						await refreshTree(vaultPath);
						await opts.onComplete?.({
							imported: alreadyInLibrary
								? []
								: [
										{
											paperDir: joinVaultPath(vaultPath, paper.path),
											path: paper.path,
											id: paper.id,
											title: paper.title,
											usedTranslator: paper.meta_source === "translator",
											translatorBaseUrl:
												paper.meta_source === "translator"
													? getSettings().translator.baseUrl
													: "",
											status: "created",
										},
									],
							skipped: alreadyInLibrary
								? [
										{
											raw: query,
											kind: paper.type,
											value: paper.id,
											reason: "already_in_library",
										},
									]
								: [],
							skills: [],
							skillCandidates: [],
							searchCandidates: [],
							errors: [],
						});
					} else
						addPaperSearchDraft([
							{
								query,
								parentDir,
								pending: false,
								candidates: result.papers.map((paper) => ({
									title: paper.title || query,
									authors: paper.authors || [],
									year: paper.year ?? undefined,
									venue: paper.publication ?? undefined,
									doi: paper.doi ?? undefined,
									identifier:
										paper.doi ||
										paper.arxiv_id ||
										paper.source_url ||
										paper.id ||
										"",
									source:
										paper.meta_source === "translator"
											? ("translator" as const)
											: ("crossref" as const),
								})),
							},
						]);
				},
				{
					onTaskId: (id) => {
						taskId = id;
						if (looksLikeTitleSearchQuery(query)) pendingSearchJobIds.add(id);
					},
					concurrency: Math.max(
						1,
						Math.min(10, getSettings().batchImportConcurrency || 1),
					),
				},
			).finally(() => {
				if (taskId) pendingSearchJobIds.delete(taskId);
			});
		};
		const outcomes = await Promise.allSettled(texts.map(process));
		const failed = outcomes.find((result) => result.status === "rejected");
		if (failed?.status === "rejected") {
			const code = errorText(failed.reason);
			throw new Error(i18n.t(`cloud:errors.${code}`, { defaultValue: code }));
		}
		return;
	}
}

/** Picked a title-search candidate → import it as a normal identifier. */
export async function confirmPaperSearchImport(
	candidate: PaperSearchCandidate,
	parentDir: string,
): Promise<void> {
	shiftPaperSearchDraft();
	await lookupSubmit([candidate.identifier], { parentDir });
}

export function cancelPaperSearchImport(): void {
	// Closing the picker also ends the searches behind it: cancel each job so
	// its card stops immediately and the host skips the remaining queries.
	for (const jobId of pendingSearchJobIds) cancelBackgroundTask(jobId);
	pendingSearchJobIds.clear();
	clearPaperSearchDraft();
}

type SkillImportSelection = { discoveryId: string; selectedNames: string[] };

export async function confirmSkillImport(
	selections: SkillImportSelection[],
): Promise<void> {
	const vaultPath = getVaultPath();
	if (!vaultPath) return;
	setSkillImportDraft(null);
	try {
		await runLocalActivity(
			{ kind: "skillImport", title: i18n.t("sidebar:lookup.skillImportTask") },
			async (ctx) => {
				const results: SkillImportResult[] = [];
				for (const selection of selections) {
					results.push(
						...(await installCloudSkills(
							selection.discoveryId,
							selection.selectedNames,
							ctx.signal,
							ctx.setProgress,
						)),
					);
				}
				await refreshTree(vaultPath);
				notifySuccess(
					i18n.t("sidebar:lookup.skillImportDone", {
						installed: results.filter((item) => !item.skipped).length,
						skipped: results.filter((item) => item.skipped).length,
					}),
				);
			},
			{ concurrency: 1 },
		);
	} catch (e) {
		if (!isBackgroundTaskCancelledError(e)) notifyError(skillImportError(e));
	} finally {
		for (const selection of selections)
			discardCloudSkillDiscovery(selection.discoveryId);
	}
}

function skillImportError(error: unknown): string {
	return cloudAiError(error);
}

function inferLookupSource(raw: string): string {
	const text = raw.trim();
	if (/npx\s+skills|github\.com|skills\.sh/i.test(text)) return "skill";
	if (/arxiv\.org|^\d{4}\.\d{4,5}(v\d+)?$/i.test(text)) return "arxiv";
	if (/^10\.\d{4,}/.test(text) || /^doi:/i.test(text)) return "doi";
	if (/^https?:\/\//i.test(text)) return "url";
	return "id";
}

export function cancelSkillImport(): void {
	const draft = uiStore.getState().skillImportDraft;
	setSkillImportDraft(null);
	for (const discovery of draft ?? []) {
		discardCloudSkillDiscovery(discovery.discoveryId);
	}
}

/** Import the checked reverse-citation candidates via the batch importer. */
export async function confirmCitingImport(
	identifiers: string[],
): Promise<void> {
	setCitingScanDraft(null);
	if (identifiers.length === 0) return;
	await lookupSubmit(identifiers, { parentDir: currentLookupParentDir() });
}

/** Nothing is staged for citing candidates, so closing is enough. */
export function cancelCitingImport(): void {
	setCitingScanDraft(null);
}

/**
 * Import local PDF file(s) → paper folders + catalog + PAPER.md.
 * - No args: native PDF picker (magic wand).
 * - `entries` + optional `parentDir`: OS-drop import.
 */
export async function importLocalPdf(opts?: {
	entries?: LocalPdfImportEntry[];
	parentDir?: string;
	vaultPath?: string;
}): Promise<void> {
	try {
		if (opts?.entries?.length) {
			const { importCloudPdfs } = await import("@/lib/cloud/catalog");
			const result = await importCloudPdfs({
				entries: opts.entries,
				parentDir: opts.parentDir ?? currentLookupParentDir(),
				vaultPath: "/cloud",
			});
			if (result.errors.length) throw new Error(result.errors.join("\n"));
			await cleanupImportTempPaths(opts.entries.map((entry) => entry.filePath));
		} else {
			const { pickAndImportPdfs } = await import("@/lib/cloud/import");
			await pickAndImportPdfs(opts?.parentDir ?? currentLookupParentDir());
		}
	} catch (error) {
		notifyError(errorText(error));
	}
	return;
}

/**
 * OS PDF drop onto a papers/ folder or the Library → instant import with
 * placeholder (filename-derived) metadata; a RecognizeMetadata job then
 * resolves identifiers in the background and renames the folder. The user
 * can always correct via Edit Metadata.
 */
export function dropLocalPdfs(
	items: Array<{ path: string; sourceName: string }>,
	parentDir: string,
): void {
	if (!items.length) return;
	const paths: string[] = [];
	const seen = new Set<string>();
	for (const item of items) {
		const path = normalizeDroppedPath(item.path);
		if (!path || seen.has(path)) continue;
		seen.add(path);
		paths.push(path);
	}
	if (!paths.length) return;
	if (!getVaultPath()) {
		notifyWarning(i18n.t("app:errors.dropPdfNeedsVault"));
		void cleanupImportTempPaths(paths);
		return;
	}
	const vaultPath = getVaultPath();
	if (!vaultPath) return;
	localPdfDropQueue.push({
		vaultPath,
		entries: paths.map((filePath) => ({ filePath })),
		parentDir: parentDir || "papers",
	});
	drainLocalPdfDropQueue();
}
