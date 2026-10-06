/**
 * Vault actions: vault switching, tree CRUD (create/trash/move/rename),
 * Finder/terminal reveal, and recycle-bin maintenance. Cross-domain effects
 * (open tabs, wiki links, library rows) flow through the domain stores.
 */

import i18n from "@/i18n";
import { clearSelections } from "@/lib/agent/selection-store";
import { clearVisualDrafts } from "@/lib/agent/visual-context-store";
import { errorText } from "@/lib/core/error";
import {
	notifyAction,
	notifyError,
	notifySuccess,
	notifyWarning,
} from "@/lib/core/notify";
import { dirnameOf, displayPath } from "@/lib/core/path";
import { isPaperDirectory, isPapersRoot, isUnderPapers } from "@/lib/paper";
import {
	isLibraryVirtualPath,
	isTrashVirtualPath,
	listTrash,
	movePaperFolder,
	purgeAllTrash,
	trashPaths,
} from "@/lib/paper/api";
import {
	bumpTrashReloadSignal,
	refreshLibrary,
	setLibraryQuery,
	setLibraryScopePath,
} from "@/lib/paper/library-store";
import type { FileNode } from "@/lib/vault";
import {
	createVault,
	createVaultDirectory,
	ensureLocalFsScope,
	isValidVaultEntryName,
	joinVaultPath,
	openNewWindow,
	pickCreateVaultDirectory,
	pickVaultDirectory,
	removeRecentVault,
	removeTreeNode,
	saveVaultPath,
	vaultPathExists,
	vaultRelativePath,
	writeVaultFile,
} from "@/lib/vault";
import { normalizePathKey as pathKey } from "@/lib/vault/path";
import { isRemoteVaultHandle } from "@/lib/vault/remote/remote-vault";
import { openInTerminal, revealInFileManager } from "@/lib/vault/reveal";
import type { TreeCreateKind } from "@/lib/vault/store";
import {
	bumpTreeGeneration,
	clearCutPaths,
	getVaultPath,
	refreshRecentVaults,
	refreshTree,
	setCreateDraft,
	setCutPaths,
	setRenameDraft,
	setTree,
	setTreeLoading,
	setTreeSelectedPath,
	setVaultBusy,
	setVaultPath,
	vaultStore,
} from "@/lib/vault/store";
import { moveVaultPath, normalizeVaultRel } from "@/lib/wiki";
import { syncMovedPaths } from "@/lib/wiki/actions";
import {
	rebuildWikiAndNotify,
	trackInternalRenamePaths,
} from "@/lib/wiki/store";
import {
	closeTabsUnderPath,
	dirtyVaultPaths,
	openPath,
} from "@/lib/workspace/actions";
import {
	clearClosedTabs,
	setActiveTabId,
	setTabs,
} from "@/lib/workspace/store";
import { basenameOf } from "@/lib/workspace/tabs";
import { isExcalidrawPath } from "@/lib/workspace/viewer";
import {
	createVisualDocument,
	visualDocumentKind,
} from "@/lib/workspace/visual-documents";

export async function activateVault(path: string): Promise<void> {
	bumpTreeGeneration();
	setTree([]);
	setTreeLoading(true);
	saveVaultPath(path);
	setVaultPath(path);
	void import("@/lib/activity").then(({ track }) => {
		track("vault.open");
	});
	setTabs([]);
	setActiveTabId(null);
	clearClosedTabs();
	setTreeSelectedPath(null);
	setLibraryQuery("");
	setLibraryScopePath(null);
	// Ephemeral composer context is vault-scoped in practice; clear so drafts
	// never write marks into the previous vault after a switch.
	clearVisualDrafts();
	clearSelections();
	refreshRecentVaults();
	// Wiki rebuild needs local fs watcher semantics; remote is best-effort.
	if (!isRemoteVaultHandle(path)) {
		await rebuildWikiAndNotify(path);
	}
}

export async function openVault(): Promise<void> {
	try {
		setVaultBusy(true);
		const path = await pickVaultDirectory();
		if (!path) return;
		await activateVault(path);
	} catch (e) {
		notifyError(errorText(e));
	} finally {
		setVaultBusy(false);
	}
}

export async function openRecentVault(path: string): Promise<void> {
	await openLocalVaultPath(path, { missingAsRecentError: true });
}

/**
 * Open a local directory as the active Vault (picker, recent, deep link, CLI).
 * Host validates deep-link paths before emit; still re-check existence here.
 */
export async function openLocalVaultPath(
	path: string,
	opts?: { missingAsRecentError?: boolean },
): Promise<void> {
	const trimmed = path?.trim();
	if (!trimmed) return;
	try {
		setVaultBusy(true);
		await ensureLocalFsScope(trimmed);
		const { exists } = await import("@/lib/cloud/fs");
		if (!(await exists(trimmed))) {
			if (opts?.missingAsRecentError) {
				removeRecentVault(trimmed);
				refreshRecentVaults();
				notifyError(i18n.t("app:vault.recentMissing", { path: trimmed }));
			} else {
				notifyError(i18n.t("app:vault.openPathMissing", { path: trimmed }));
			}
			return;
		}
		// Skip no-op switch to the already-active vault (normalize trailing slash).
		const current = (getVaultPath() ?? "").replace(/[\\/]+$/, "");
		const next = trimmed.replace(/[\\/]+$/, "");
		if (current && current === next) {
			return;
		}
		await activateVault(trimmed);
	} catch (e) {
		notifyError(errorText(e));
	} finally {
		setVaultBusy(false);
	}
}

export function removeRecent(path: string): void {
	removeRecentVault(path);
	refreshRecentVaults();
}

export async function newWindow(): Promise<void> {
	try {
		await openNewWindow();
	} catch (e) {
		notifyError(errorText(e));
	}
}

/** Full refresh: tree, wiki index, library rows. */
export function refreshAll(): void {
	const vaultPath = getVaultPath();
	if (!vaultPath) return;
	void (async () => {
		await refreshTree(vaultPath);
		// Wiki rebuild needs local fs semantics; a remote handle always fails.
		if (!isRemoteVaultHandle(vaultPath)) {
			await rebuildWikiAndNotify(vaultPath);
		}
		await refreshLibrary();
	})();
}

/**
 * Seed missing bundled Skills and vault instructions; preserve all user overrides.
 */
export function seedVaultSkills(_path: string): void {
	void import("@/lib/cloud/skills")
		.then(({ installBundledSkills }) => installBundledSkills())
		.catch((error) => notifyError(errorText(error)));
}

/** ⌥⌘R — reveal selected vault path in Finder / Explorer. */
export function revealSelectedInFinder(): void {
	const { treeSelectedPath, vaultPath } = vaultStore.getState();
	const path = treeSelectedPath;
	if (!path || isLibraryVirtualPath(path) || isTrashVirtualPath(path)) return;
	if (isRemoteVaultHandle(vaultPath) || isRemoteVaultHandle(path)) {
		notifyWarning(i18n.t("app:vault.remoteNoFinder"));
		return;
	}

	void (async () => {
		try {
			await revealInFileManager(path);
		} catch {
			notifyError(i18n.t("sidebar:fileTree.revealFailed"));
		}
	})();
}

/** ⌥⌘T — open system terminal at selected path (dir = self, file = parent). */
export function openSelectedInTerminal(): void {
	const { treeSelectedPath, vaultPath } = vaultStore.getState();
	const path = treeSelectedPath;
	if (!path || isLibraryVirtualPath(path) || isTrashVirtualPath(path)) return;
	if (isRemoteVaultHandle(vaultPath) || isRemoteVaultHandle(path)) {
		notifyWarning(i18n.t("app:vault.remoteNoTerminal"));
		return;
	}

	void (async () => {
		try {
			await openInTerminal(path);
		} catch {
			notifyError(i18n.t("sidebar:fileTree.openInTerminalFailed"));
		}
	})();
}

/** Delete vault paths into the recycle bin (`.agentero/.trash/`). */
export async function trashPathsAndNotify(absPaths: string[]): Promise<void> {
	const vaultPath = getVaultPath();
	if (!vaultPath || !true) {
		notifyError(i18n.t("sidebar:fileTree.deleteDesktopOnly"));
		return;
	}
	const rootNorm = vaultPath.replace(/\\/g, "/").replace(/\/+$/, "");
	const valid = absPaths
		.map((p) => p.replace(/\\/g, "/").replace(/\/+$/, ""))
		.filter(
			(p) =>
				p &&
				!isLibraryVirtualPath(p) &&
				!isTrashVirtualPath(p) &&
				p !== rootNorm &&
				p.startsWith(`${rootNorm}/`),
		);
	if (valid.length === 0) return;
	setVaultBusy(true);
	trackInternalRenamePaths(valid, Number.POSITIVE_INFINITY);
	try {
		const rels = valid
			.map((p) => vaultRelativePath(vaultPath, p))
			.filter((r): r is string => Boolean(r));
		await trashPaths(vaultPath, rels);
		for (const p of valid) closeTabsUnderPath(p);
		// Optimistic prune so a concurrent remote list of the deleted path
		// cannot leave a ghost folder while refresh rebuilds.
		let pruned = vaultStore.getState().tree;
		for (const p of valid) {
			pruned = removeTreeNode(pruned, p);
		}
		setTree(pruned);
		const treeNorm = vaultStore
			.getState()
			.treeSelectedPath?.replace(/\\/g, "/")
			.replace(/\/+$/, "");
		if (
			treeNorm &&
			valid.some((p) => treeNorm === p || treeNorm.startsWith(`${p}/`))
		) {
			setTreeSelectedPath(null);
		}
		await refreshTree(vaultPath);
		if (!isRemoteVaultHandle(vaultPath)) {
			await rebuildWikiAndNotify(vaultPath);
		}
		await refreshLibrary();
	} catch (e) {
		notifyError(
			e instanceof Error ? e.message : i18n.t("sidebar:fileTree.deleteFailed"),
		);
	} finally {
		trackInternalRenamePaths(valid, Date.now() + 2000);
		setVaultBusy(false);
	}
}

export function deleteSelectedPath(): void {
	const path = vaultStore.getState().treeSelectedPath;
	if (!path || isLibraryVirtualPath(path) || isTrashVirtualPath(path)) {
		notifyError(i18n.t("sidebar:fileTree.deleteNeedsSelection"));
		return;
	}
	void trashPathsAndNotify([path]);
}

/** Refresh tree / library / wiki after a recycle-bin restore. */
export async function handleTrashChanged(): Promise<void> {
	const vaultPath = getVaultPath();
	if (!vaultPath) return;
	setTreeSelectedPath(null);
	await refreshTree(vaultPath);
	// Wiki rebuild needs local fs semantics; a remote handle always fails.
	if (!isRemoteVaultHandle(vaultPath)) {
		await rebuildWikiAndNotify(vaultPath);
	}
	await refreshLibrary();
}

/** Empty recycle bin from the trash node context menu (confirm + purge). */
export async function emptyTrash(): Promise<void> {
	const vaultPath = getVaultPath();
	if (!vaultPath || !true) return;
	try {
		const items = await listTrash(vaultPath);
		if (items.length === 0) return;
		if (
			!window.confirm(
				i18n.t("sidebar:recycleBin.emptyConfirm", { count: items.length }),
			)
		) {
			return;
		}
		await purgeAllTrash(vaultPath);
		bumpTrashReloadSignal();
	} catch (e) {
		notifyError(
			e instanceof Error ? e.message : i18n.t("sidebar:recycleBin.purgeFailed"),
		);
	}
}

/** Core move loop reused by the dialog and by drag-and-drop. */
export async function movePathsTo(
	rawPaths: string[],
	destParentRel: string,
): Promise<void> {
	const vaultPath = getVaultPath();
	if (!vaultPath) return;
	const paths = rawPaths.filter(
		(p) => !isLibraryVirtualPath(p) && !isTrashVirtualPath(p),
	);
	if (paths.length === 0) return;
	setVaultBusy(true);
	let failed = 0;
	try {
		for (const path of paths) {
			const rel = vaultRelativePath(vaultPath, path);
			if (!rel) {
				failed++;
				continue;
			}
			const destinationParent = normalizeVaultRel(destParentRel) || "papers";
			const expectedToRel = `${destinationParent}/${basenameOf(rel)}`;
			// Already at the requested destination; nothing to do.
			if (normalizeVaultRel(expectedToRel) === normalizeVaultRel(rel)) {
				continue;
			}
			const pendingEventPaths = [path, joinVaultPath(vaultPath, expectedToRel)];
			trackInternalRenamePaths(pendingEventPaths, Number.POSITIVE_INFINITY);
			try {
				const result = await movePaperFolder(
					vaultPath,
					rel,
					destParentRel,
					dirtyVaultPaths(vaultPath),
				);
				const toAbs = joinVaultPath(vaultPath, result.newRel);
				syncMovedPaths(
					vaultPath,
					path,
					toAbs,
					rel,
					result.newRel,
					result.linkUpdate,
				);
			} catch {
				trackInternalRenamePaths(pendingEventPaths, Date.now() + 2000);
				failed++;
			}
		}
		await refreshTree(vaultPath);
		await refreshLibrary();
		if (failed > 0) {
			notifyWarning(
				i18n.t("sidebar:fileTree.movedWithErrors", { count: failed }),
			);
		}
	} catch (e) {
		notifyError(
			e instanceof Error ? e.message : i18n.t("sidebar:fileTree.moveFailed"),
		);
	} finally {
		setVaultBusy(false);
	}
}

/** Find a tree node by absolute path (case-insensitive). */
function findTreeNode(tree: FileNode[], target: string): FileNode | undefined {
	const key = pathKey(target);
	let found: FileNode | undefined;
	const walk = (nodes: FileNode[]) => {
		for (const n of nodes) {
			if (pathKey(n.path) === key) {
				found = n;
				return;
			}
			if (n.children) walk(n.children);
		}
	};
	walk(tree);
	return found;
}

/** Stage non-virtual vault paths for a subsequent paste (Cut). */
export function cutSelectedPaths(rawPaths: string[]): void {
	const vaultPath = getVaultPath();
	if (!vaultPath) {
		notifyError(i18n.t("sidebar:fileTree.needsVault"));
		return;
	}

	if (isRemoteVaultHandle(vaultPath)) {
		notifyWarning(i18n.t("sidebar:fileTree.remoteCutPasteDisabled"));
		return;
	}
	const rootKey = pathKey(vaultPath);
	const valid = rawPaths
		.map((p) => p.replace(/\\/g, "/").replace(/\/+$/, ""))
		.filter(
			(p) =>
				p &&
				pathKey(p).startsWith(`${rootKey}/`) &&
				!isLibraryVirtualPath(p) &&
				!isTrashVirtualPath(p),
		);
	if (valid.length === 0) {
		notifyError(i18n.t("sidebar:fileTree.cutNeedsSelection"));
		return;
	}
	setCutPaths(valid);
	notifyAction(i18n.t("sidebar:fileTree.cutItems", { count: valid.length }), {
		id: "file-tree-cut",
		duration: 6000,
		actionLabel: i18n.t("sidebar:fileTree.clearCut"),
		onAction: () => clearCutPaths(),
	});
}

/** Resolve the destination parent folder for a paste or drop target. */
export function resolvePasteDestination(
	vaultPath: string,
	tree: FileNode[],
	targetPath: string | null | undefined,
): { abs: string; rel: string; isPaperLeaf: boolean } | null {
	if (
		!targetPath ||
		isLibraryVirtualPath(targetPath) ||
		isTrashVirtualPath(targetPath)
	) {
		// No selection / virtual target → paste at vault root.
		return { abs: vaultPath, rel: "", isPaperLeaf: false };
	}
	const norm = targetPath.replace(/\\/g, "/").replace(/\/+$/, "");
	const rootKey = pathKey(vaultPath);
	if (pathKey(norm) === rootKey) {
		return { abs: vaultPath, rel: "", isPaperLeaf: false };
	}
	const node = findTreeNode(tree, norm);
	const isPaperLeaf =
		node?.kind === "directory" && isPaperDirectory(node.path, node.children);

	// Paper folders are minimal catalog units: never paste inside them.
	if (isPaperLeaf) {
		const parentAbs = dirnameOf(norm);
		if (!parentAbs || pathKey(parentAbs) === rootKey) {
			return { abs: vaultPath, rel: "", isPaperLeaf: true };
		}
		return {
			abs: parentAbs,
			rel: vaultRelativePath(vaultPath, parentAbs) || "",
			isPaperLeaf: true,
		};
	}

	if (node?.kind === "directory") {
		return {
			abs: norm,
			rel: vaultRelativePath(vaultPath, norm) || "",
			isPaperLeaf: false,
		};
	}

	// File → use parent directory.
	const parentAbs = dirnameOf(norm);
	if (!parentAbs || pathKey(parentAbs) === rootKey) {
		return { abs: vaultPath, rel: "", isPaperLeaf: false };
	}
	return {
		abs: parentAbs,
		rel: vaultRelativePath(vaultPath, parentAbs) || "",
		isPaperLeaf: false,
	};
}

type PasteDestination = {
	abs: string;
	rel: string;
	isPaperLeaf: boolean;
};

/** Move a list of absolute source paths into a resolved destination parent. */
async function movePathsToDestination(
	vaultPath: string,
	srcAbsPaths: string[],
	dest: PasteDestination,
): Promise<{ failed: string[]; blocked: string[] }> {
	const destRel = normalizeVaultRel(dest.rel);
	const destUnderPapers = destRel === "papers" || destRel.startsWith("papers/");
	const rootKey = pathKey(vaultPath);
	const failed: string[] = [];
	const blocked: string[] = [];

	for (const srcAbs of srcAbsPaths) {
		const normSrc = srcAbs.replace(/\\/g, "/").replace(/\/+$/, "");
		if (!normSrc || pathKey(normSrc) === rootKey) {
			failed.push(srcAbs);
			continue;
		}
		const srcRel = vaultRelativePath(vaultPath, normSrc);
		if (!srcRel) {
			failed.push(srcAbs);
			continue;
		}

		// Reject moving papers/ root itself.
		if (isPapersRoot(srcRel)) {
			failed.push(srcAbs);
			continue;
		}

		// Reject descendant moves (pasting into the source or its child).
		const destAbsKey = pathKey(dest.abs);
		const srcKey = pathKey(normSrc);
		if (destAbsKey === srcKey || destAbsKey.startsWith(`${srcKey}/`)) {
			failed.push(srcAbs);
			continue;
		}

		// Keep items currently under papers/ inside papers/ to preserve catalog integrity.
		if (isUnderPapers(srcRel) && !destUnderPapers) {
			notifyWarning(
				i18n.t("sidebar:fileTree.paperMoveOutsidePapers", {
					name: basenameOf(srcRel),
				}),
			);
			blocked.push(srcAbs);
			continue;
		}

		const base = basenameOf(srcRel);
		const toRel = destRel ? `${destRel}/${base}` : base;
		const toAbs = joinVaultPath(vaultPath, toRel);
		// Already at the resolved destination; nothing to do.
		if (pathKey(toAbs) === srcKey) {
			continue;
		}
		const pendingEventPaths = [normSrc, toAbs];
		trackInternalRenamePaths(pendingEventPaths, Number.POSITIVE_INFINITY);

		try {
			if (destUnderPapers && isUnderPapers(srcRel)) {
				const result = await movePaperFolder(
					vaultPath,
					srcRel,
					destRel || "papers",
					dirtyVaultPaths(vaultPath),
				);
				syncMovedPaths(
					vaultPath,
					normSrc,
					toAbs,
					srcRel,
					result.newRel,
					result.linkUpdate,
				);
			} else {
				const result = await moveVaultPath(
					vaultPath,
					srcRel,
					toRel,
					dirtyVaultPaths(vaultPath),
				);
				syncMovedPaths(vaultPath, normSrc, toAbs, srcRel, toRel, result);
			}
		} catch {
			trackInternalRenamePaths(pendingEventPaths, Date.now() + 2000);
			failed.push(srcAbs);
		}
	}

	return { failed, blocked };
}

/** Paste previously cut paths into the given target (folder, file, or vault root). */
export async function pasteCutPaths(
	targetPath: string | null | undefined,
): Promise<void> {
	const vaultPath = getVaultPath();
	if (!vaultPath) {
		notifyError(i18n.t("sidebar:fileTree.needsVault"));
		return;
	}

	if (isRemoteVaultHandle(vaultPath)) {
		notifyWarning(i18n.t("sidebar:fileTree.remoteCutPasteDisabled"));
		return;
	}

	const { cutPaths } = vaultStore.getState();
	if (cutPaths.length === 0) return;

	const { tree } = vaultStore.getState();
	const dest = resolvePasteDestination(vaultPath, tree, targetPath);
	if (!dest) {
		notifyError(i18n.t("sidebar:fileTree.pasteNeedsSelection"));
		return;
	}

	setVaultBusy(true);

	try {
		const { failed, blocked } = await movePathsToDestination(
			vaultPath,
			cutPaths,
			dest,
		);
		// Clear successfully moved items; keep failed/blocked ones staged so the
		// user sees what did not move.
		setCutPaths([...failed, ...blocked]);
		await refreshTree(vaultPath);
		await refreshLibrary();
		if (!isRemoteVaultHandle(vaultPath)) {
			await rebuildWikiAndNotify(vaultPath);
		}
		if (failed.length > 0 || blocked.length > 0) {
			notifyWarning(
				i18n.t("sidebar:fileTree.pastedWithErrors", {
					count: failed.length + blocked.length,
				}),
			);
		}
	} catch (e) {
		notifyError(
			e instanceof Error ? e.message : i18n.t("sidebar:fileTree.pasteFailed"),
		);
	} finally {
		setVaultBusy(false);
	}
}

/** Move a list of paths to the destination implied by the drop target. */
export async function dropMovePaths(
	rawPaths: string[],
	targetPath: string | null | undefined,
): Promise<void> {
	const vaultPath = getVaultPath();
	if (!vaultPath) {
		notifyError(i18n.t("sidebar:fileTree.needsVault"));
		return;
	}

	if (isRemoteVaultHandle(vaultPath)) {
		notifyWarning(i18n.t("sidebar:fileTree.remoteCutPasteDisabled"));
		return;
	}

	const { tree } = vaultStore.getState();
	const dest = resolvePasteDestination(vaultPath, tree, targetPath);
	if (!dest) {
		notifyError(i18n.t("sidebar:fileTree.pasteNeedsSelection"));
		return;
	}

	setVaultBusy(true);

	try {
		const { failed, blocked } = await movePathsToDestination(
			vaultPath,
			rawPaths,
			dest,
		);
		await refreshTree(vaultPath);
		await refreshLibrary();
		if (!isRemoteVaultHandle(vaultPath)) {
			await rebuildWikiAndNotify(vaultPath);
		}
		if (failed.length > 0 || blocked.length > 0) {
			notifyWarning(
				i18n.t("sidebar:fileTree.movedWithErrors", {
					count: failed.length + blocked.length,
				}),
			);
		}
	} catch (e) {
		notifyError(
			e instanceof Error ? e.message : i18n.t("sidebar:fileTree.moveFailed"),
		);
	} finally {
		setVaultBusy(false);
	}
}

/** Start inline rename for a tree path. */
export function startRenamePath(path: string): void {
	const vaultPath = getVaultPath();
	if (!vaultPath || isRemoteVaultHandle(vaultPath)) {
		notifyWarning(i18n.t("app:vault.remoteNoAutoLinkRepair"));
		return;
	}
	const fromRel = vaultRelativePath(vaultPath, path);
	if (!fromRel) return;
	setRenameDraft({ path, currentName: basenameOf(path) });
}

export function cancelRenamePath(): void {
	setRenameDraft(null);
}

export async function confirmRenamePath(
	path: string,
	nextName: string,
): Promise<void> {
	const vaultPath = getVaultPath();
	if (!vaultPath) return;
	const trimmed = nextName.trim();
	if (!isValidVaultEntryName(trimmed)) {
		notifyError(i18n.t("sidebar:fileTree.invalidName"));
		setRenameDraft(null);
		return;
	}
	const fromRel = vaultRelativePath(vaultPath, path);
	if (!fromRel) {
		notifyError(i18n.t("sidebar:fileTree.renameFailed"));
		setRenameDraft(null);
		return;
	}
	const currentName = basenameOf(fromRel);
	if (trimmed === currentName) {
		setRenameDraft(null);
		return;
	}
	const parent = fromRel.includes("/")
		? fromRel.slice(0, fromRel.lastIndexOf("/"))
		: "";
	const toRel = parent ? `${parent}/${trimmed}` : trimmed;
	const toAbs = joinVaultPath(vaultPath, toRel);
	const pendingEventPaths = [path, toAbs];
	trackInternalRenamePaths(pendingEventPaths, Number.POSITIVE_INFINITY);
	setVaultBusy(true);
	try {
		const result = await moveVaultPath(
			vaultPath,
			fromRel,
			toRel,
			dirtyVaultPaths(vaultPath),
		);
		syncMovedPaths(vaultPath, path, toAbs, fromRel, toRel, result);
		await refreshTree(vaultPath);
		await refreshLibrary();
		setRenameDraft(null);
		notifySuccess(
			i18n.t("sidebar:fileTree.renamedLinks", {
				count: result.updatedSources.length,
			}),
		);
	} catch (error) {
		trackInternalRenamePaths(pendingEventPaths, Date.now() + 2000);
		notifyError(
			error instanceof Error
				? error.message
				: i18n.t("sidebar:fileTree.renameFailed"),
		);
	} finally {
		setVaultBusy(false);
	}
}

export function startCreate(kind: TreeCreateKind, parentPath: string): void {
	if (!getVaultPath() || !true) {
		notifyError(i18n.t("sidebar:fileTree.needsVault"));
		return;
	}
	setCreateDraft({ kind, parentPath });
}

export function cancelCreate(): void {
	setCreateDraft(null);
}

export async function confirmCreate(name: string): Promise<void> {
	const { createDraft } = vaultStore.getState();
	const vaultPath = getVaultPath();
	if (!createDraft || !vaultPath || !true) {
		setCreateDraft(null);
		return;
	}
	const trimmed = name.trim();
	if (!isValidVaultEntryName(trimmed)) {
		notifyError(i18n.t("sidebar:fileTree.invalidName"));
		setCreateDraft(null);
		return;
	}
	const kind = createDraft.kind;
	const suffix =
		kind === "excalidraw"
			? ".excalidraw"
			: kind === "mindmap" || kind === "kanban"
				? `.${kind}.json`
				: "";
	const filename =
		kind === "file" && !trimmed.startsWith(".") && !/\.[^./\\]+$/.test(trimmed)
			? `${trimmed}.md`
			: suffix && !trimmed.toLowerCase().endsWith(suffix)
				? `${trimmed}${suffix}`
				: trimmed;
	const full = joinVaultPath(createDraft.parentPath, filename);
	// Clear draft first so the tree can re-render after create.
	setCreateDraft(null);
	try {
		setVaultBusy(true);
		// Use vault-aware exists: local FS plugin cannot see `remote:<id>/…`.
		if (await vaultPathExists(full)) {
			notifyError(i18n.t("sidebar:fileTree.alreadyExists", { name: trimmed }));
			return;
		}
		if (kind !== "folder") {
			const visualKind = visualDocumentKind(filename);
			const initialContent = visualKind
				? `${JSON.stringify(
						createVisualDocument(visualKind, {
							topic: i18n.t("viewer:visual.topic"),
							columns: [
								i18n.t("viewer:visual.todo"),
								i18n.t("viewer:visual.doing"),
								i18n.t("viewer:visual.done"),
							],
						}),
						null,
						2,
					)}\n`
				: isExcalidrawPath(filename)
					? JSON.stringify({
							type: "excalidraw",
							version: 2,
							source: "https://excalidraw.com",
							elements: [],
							appState: {},
							files: {},
						})
					: "";
			await writeVaultFile(full, initialContent);
			await refreshTree(vaultPath);
			openPath(full);
		} else {
			await createVaultDirectory(full);
			await refreshTree(vaultPath);
			setTreeSelectedPath(full);
		}
	} catch (e) {
		notifyError(errorText(e));
	} finally {
		setVaultBusy(false);
	}
}

export async function createNewVault(): Promise<void> {
	try {
		setVaultBusy(true);
		const path = await pickCreateVaultDirectory();
		if (!path) return;
		const result = await createVault(path, i18n.language);
		const root = result.path || path;
		await activateVault(root);
		const sep = root.includes("\\") ? "\\" : "/";
		const openRel = result.openPath || "AGENTS.md";
		const openAbs = `${root.replace(/[\\/]+$/, "")}${sep}${openRel.replace(/\//g, sep)}`;
		openPath(openAbs);
	} catch (e) {
		notifyError(errorText(e));
	} finally {
		setVaultBusy(false);
	}
}

/** Welcome-page entry: create a vault, then open the Zotero migrate dialog. */

export function validateRestoredVault(): Promise<void> {
	const restoredPath = getVaultPath();
	if (!restoredPath || isRemoteVaultHandle(restoredPath)) {
		return Promise.resolve();
	}
	return ensureLocalFsScope(restoredPath)
		.then(() => import("@/lib/cloud/fs"))
		.then(({ exists }) => exists(restoredPath))
		.then((pathExists) => {
			if (pathExists || getVaultPath() !== restoredPath) return;
			saveVaultPath(null);
			setVaultPath(null);
			setTree([]);
			setTabs([]);
			setActiveTabId(null);
			clearClosedTabs();
			setTreeSelectedPath(null);
			notifyError(
				i18n.t("app:vault.restoredVaultMissing", {
					path: displayPath(restoredPath),
				}),
			);
		})
		.catch(() => {
			// Leave the restored state intact when the existence check fails.
		});
}
