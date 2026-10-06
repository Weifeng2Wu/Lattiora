/**
 * Vault / file-tree state (zustand vanilla).
 * Plain modules mutate via exported functions; React subscribes through
 * `useVaultStore` with selectors. Tree-derived lists are computed once per
 * `setTree` so consumers never chain useMemo over the whole tree.
 */

import { createStore } from "zustand/vanilla";
import { errorText } from "@/lib/core/error";
import { notifyError } from "@/lib/core/notify";
import { collectPaperFoldersFromTree } from "@/lib/paper";
import {
	collectDirectoryRelPaths,
	collectMarkdownRelPaths,
	collectTreeRefreshTargets,
	collectWikiTargetRelPaths,
	type FileNode,
	getRecentVaults,
	isPathMissingError,
	listVaultDirChildren,
	loadVaultTree,
	removeTreeNode,
	replaceTreeNodeChildren,
} from "@/lib/vault";
import { watchRefreshDelayMs } from "@/lib/vault/shell-activity";
import { toVaultRelative } from "@/lib/wiki";

export type TreeCreateKind =
	| "file"
	| "folder"
	| "mindmap"
	| "kanban"
	| "excalidraw";

export type TreeCreateDraft = {
	kind: TreeCreateKind;
	/** Absolute path of the parent directory (vault root or folder). */
	parentPath: string;
};

export type TreeRenameDraft = {
	/** Absolute path of the file/folder/paper being renamed. */
	path: string;
	/** Current disk name (basename). */
	currentName: string;
};

type VaultTreeDerived = {
	vaultMdFiles: string[];
	vaultWikiTargetFiles: string[];
	/** Directory paths for Agent context chip folder icons. */
	vaultDirPaths: string[];
	/** Paper folders at any depth under papers/ (marker-based, absolute). */
	paperFolders: string[];
	/** Vault-relative paper paths for Agent chip paper icons. */
	vaultPaperPaths: string[];
};

type VaultStore = VaultTreeDerived & {
	vaultPath: string | null;
	tree: FileNode[];
	treeLoading: boolean;
	busy: boolean;
	/** File-tree selection / create-parent context. */
	treeSelectedPath: string | null;
	/** Inline new file/folder draft in the tree (IDE-style). */
	createDraft: TreeCreateDraft | null;
	/** Inline rename draft in the tree (replaces the rename dialog). */
	renameDraft: TreeRenameDraft | null;
	recentVaults: string[];
	/** Absolute paths staged by Cut (⌘X) until pasted or cancelled. */
	cutPaths: string[];
};

function deriveFromTree(
	tree: FileNode[],
	vaultPath: string | null,
): VaultTreeDerived {
	const paperFolders = collectPaperFoldersFromTree(tree);
	return {
		vaultMdFiles: collectMarkdownRelPaths(tree, vaultPath),
		vaultWikiTargetFiles: collectWikiTargetRelPaths(tree, vaultPath),
		vaultDirPaths: collectDirectoryRelPaths(tree, vaultPath),
		paperFolders,
		vaultPaperPaths: paperFolders
			.map((p) => toVaultRelative(vaultPath, p))
			.filter((p) => p.length > 0),
	};
}

export const vaultStore = createStore<VaultStore>(() => ({
	vaultPath: null,
	tree: [],
	treeLoading: false,
	busy: false,
	treeSelectedPath: null,
	createDraft: null,
	renameDraft: null,
	recentVaults: [],
	cutPaths: [],
	...deriveFromTree([], null),
}));

let initialized = false;

/** Seed persisted vault path / recents; call once after settings are loaded. */
export function initVaultStore(): void {
	if (initialized) return;
	initialized = true;
	const vaultPath = "/cloud";
	vaultStore.setState({
		vaultPath,
		treeLoading: Boolean(vaultPath),
		recentVaults: getRecentVaults(),
		...deriveFromTree([], vaultPath),
	});
}

export function getVaultPath(): string | null {
	return vaultStore.getState().vaultPath;
}

export function setVaultPath(path: string | null): void {
	const { tree } = vaultStore.getState();
	vaultStore.setState({
		vaultPath: path,
		cutPaths: [],
		...deriveFromTree(tree, path),
	});
}

export function setTree(tree: FileNode[]): void {
	const { vaultPath } = vaultStore.getState();
	vaultStore.setState({ tree, ...deriveFromTree(tree, vaultPath) });
}

export function setTreeLoading(loading: boolean): void {
	vaultStore.setState({ treeLoading: loading });
}

export function setVaultBusy(busy: boolean): void {
	vaultStore.setState({ busy });
}

export function setTreeSelectedPath(
	path: string | null | ((previous: string | null) => string | null),
): void {
	if (typeof path === "function") {
		vaultStore.setState((s) => ({
			treeSelectedPath: path(s.treeSelectedPath),
		}));
		return;
	}
	vaultStore.setState({ treeSelectedPath: path });
}

export function setCreateDraft(draft: TreeCreateDraft | null): void {
	vaultStore.setState({ createDraft: draft });
}

export function setRenameDraft(draft: TreeRenameDraft | null): void {
	vaultStore.setState({ renameDraft: draft });
}

export function setCutPaths(paths: string[]): void {
	vaultStore.setState({ cutPaths: paths });
}

export function clearCutPaths(): void {
	vaultStore.setState({ cutPaths: [] });
}

export function refreshRecentVaults(): void {
	vaultStore.setState({ recentVaults: getRecentVaults() });
}

/** Invalidates in-flight tree loads when the active Vault changes. */
let treeLoadGeneration = 0;
let treeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
/** Changed paths accumulated for the next debounced (targeted) tree refresh. */
const treeRefreshPaths = new Set<string>();

export function bumpTreeGeneration(): void {
	treeLoadGeneration += 1;
	if (treeRefreshTimer) {
		clearTimeout(treeRefreshTimer);
		treeRefreshTimer = null;
	}
	treeRefreshPaths.clear();
}

export async function refreshTree(
	path: string,
	{ quiet = false }: { quiet?: boolean } = {},
): Promise<void> {
	if (getVaultPath() !== path) return;
	const generation = treeLoadGeneration;
	if (!quiet) {
		vaultStore.setState({ treeLoading: true, busy: true });
	}
	try {
		const nodes = await loadVaultTree(path);
		if (getVaultPath() === path && treeLoadGeneration === generation) {
			setTree(nodes);
		}
	} catch (e) {
		if (getVaultPath() === path && treeLoadGeneration === generation) {
			if (quiet) {
				// best-effort background refresh
			} else {
				const message = errorText(e);
				notifyError(message);
				// Keep the previous tree: a transient remote miss must not blank the sidebar.
			}
		}
	} finally {
		// Only the generation guards the reset: validateRestoredVault may clear
		// vaultPath mid-load (invalid restored path), and a path-based guard
		// would strand busy:true, freezing the whole welcome page.
		if (!quiet && treeLoadGeneration === generation) {
			vaultStore.setState({ treeLoading: false, busy: false });
		}
	}
}

/**
 * Lazy tree expand: list one level under a non-eager folder (`src/`, …).
 * Eager roots (`papers/` …) are fully loaded in `loadVaultTree`.
 */
export async function loadDirChildren(dirPath: string): Promise<void> {
	const vault = getVaultPath();
	if (!vault) return;
	const generation = treeLoadGeneration;
	try {
		const children = await listVaultDirChildren(vault, dirPath);
		if (getVaultPath() === vault && treeLoadGeneration === generation) {
			setTree(
				replaceTreeNodeChildren(vaultStore.getState().tree, dirPath, children),
			);
		}
	} catch (e) {
		if (getVaultPath() !== vault || treeLoadGeneration !== generation) return;
		// Path vanished mid-expand (e.g. remote delete): drop the ghost node quietly.
		if (isPathMissingError(e)) {
			setTree(removeTreeNode(vaultStore.getState().tree, dirPath));
			return;
		}
		notifyError(errorText(e));
	}
}

/**
 * Debounced, quiet file-tree reload (no busy flicker) for external
 * create/delete/rename. Re-lists only the affected directories when the
 * changed paths map onto loaded tree nodes; falls back to a full rebuild
 * otherwise (change at the vault root, too many targets, remote vault).
 */
export function scheduleTreeRefresh(changedAbsPaths?: string[]): void {
	// Callers without path info (rescan, manual) force a full rebuild.
	if (!changedAbsPaths?.length) treeRefreshPaths.add("");
	else for (const p of changedAbsPaths) treeRefreshPaths.add(p);
	if (treeRefreshTimer) clearTimeout(treeRefreshTimer);
	treeRefreshTimer = setTimeout(() => {
		treeRefreshTimer = null;
		const vault = getVaultPath();
		const changed = [...treeRefreshPaths];
		treeRefreshPaths.clear();
		if (!vault) return;
		const generation = treeLoadGeneration;
		const fresh = () =>
			getVaultPath() === vault && treeLoadGeneration === generation;

		const targets = changed.includes("")
			? null
			: collectTreeRefreshTargets(vaultStore.getState().tree, vault, changed);
		if (targets && targets.length === 0) return;

		const refresh = async () => {
			if (targets) {
				const patches = await Promise.all(
					targets.map(async (dir) => ({
						dir,
						children: await listVaultDirChildren(vault, dir),
					})),
				);
				if (!fresh()) return;
				setTree(
					patches.reduce(
						(acc, p) => replaceTreeNodeChildren(acc, p.dir, p.children),
						vaultStore.getState().tree,
					),
				);
				return;
			}
			const nodes = await loadVaultTree(vault);
			if (fresh()) setTree(nodes);
		};
		void refresh().catch(() => {
			// A target may have vanished mid-refresh: fall back to a full reload.
			if (!targets) return;
			void loadVaultTree(vault)
				.then((nodes) => {
					if (fresh()) setTree(nodes);
				})
				.catch(() => {
					// best-effort background refresh
				});
		});
	}, watchRefreshDelayMs("tree"));
}
