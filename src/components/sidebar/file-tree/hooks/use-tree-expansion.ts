/**
 * Expand/collapse state of the vault tree: default expansion per Vault open,
 * lazy listing of folders with `childrenPending`, ancestor expansion for
 * reveal, and the VS Code-like collapse actions.
 */
import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { isPaperDirectory, isUnderPaperAttachments } from "@/lib/paper";
import type { FileNode } from "@/lib/vault";
import {
	ancestorPaths,
	collectDefaultExpanded,
	collectPapersRootOnlyExpanded,
	isTreeExpandableDirectory,
	isVirtualTreePath,
	pathKey,
	visibleTreeChildren,
} from "../tree-helpers";
import type { TreeCreateDraft } from "../types";

export type TreeExpansion = {
	expanded: Set<string>;
	setExpanded: Dispatch<SetStateAction<Set<string>>>;
	/**
	 * `onExpandedChange` for AiFileTree (chevron / folder-row clicks). A shrink
	 * is a user collapse: arm reveal suppression so the flatRows-driven
	 * auto-reveal does not instantly re-expand the folder (VS Code semantics:
	 * an intentional collapse always wins over reveal).
	 */
	setExpandedFromTree: (next: Set<string>) => void;
	/** Paths currently being listed (lazy expand). */
	loadingDirs: ReadonlySet<string>;
	/** Only expand papers/ (list direct children; do not expand subfolders). */
	collapseToDefault: () => void;
	/**
	 * Collapse each path independently (VS Code list.collapse-ish):
	 * - expandable folder that is open → collapse it;
	 * - leaf / already-collapsed folder → collapse nearest open parent.
	 */
	collapsePaths: (paths: string[]) => void;
	expandAncestorsOf: (target: string) => void;
	/** Toggle a row open/closed, same as a folder chevron click. */
	togglePath: (path: string) => void;
	/**
	 * After an intentional collapse, skip one flatRows-driven re-reveal so a deep
	 * selection does not immediately re-expand collapsed ancestors.
	 */
	suppressAutoRevealRef: RefObject<boolean>;
};

export function useTreeExpansion({
	nodes,
	vaultPath,
	createDraft,
	byPathKey,
	onLoadDirChildren,
}: {
	nodes: FileNode[];
	vaultPath: string | null;
	createDraft: TreeCreateDraft | null;
	byPathKey: ReadonlyMap<string, FileNode>;
	onLoadDirChildren?: (dirPath: string) => void | Promise<void>;
}): TreeExpansion {
	const [expanded, setExpanded] = useState<Set<string>>(() => {
		const open = new Set<string>();
		collectDefaultExpanded(nodes, open);
		return open;
	});
	const [loadingDirs, setLoadingDirs] = useState<Set<string>>(() => new Set());
	const loadingDirsRef = useRef<Set<string>>(new Set());
	const suppressAutoRevealRef = useRef(false);

	/**
	 * Apply default expansion once per Vault open (when tree first has nodes).
	 * Do not reset on every tree refresh — that would collapse user-expanded
	 * folders and wipe ancestors opened for scroll-into-view.
	 */
	const defaultAppliedForVaultRef = useRef<string | null>(null);
	useEffect(() => {
		if (!vaultPath) {
			defaultAppliedForVaultRef.current = null;
			setExpanded(new Set());
			return;
		}
		if (defaultAppliedForVaultRef.current === vaultPath) return;
		if (nodes.length === 0) return;
		const open = new Set<string>();
		collectDefaultExpanded(nodes, open);
		setExpanded(open);
		defaultAppliedForVaultRef.current = vaultPath;
	}, [vaultPath, nodes]);

	/**
	 * When expanded folders still have `childrenPending`, ask parent to list them.
	 * Covers click-expand, default expand, and reveal-ancestors.
	 */
	useEffect(() => {
		if (!onLoadDirChildren) return;
		const pending: string[] = [];
		const walk = (list: FileNode[]) => {
			for (const n of list) {
				if (n.kind !== "directory") continue;
				if (
					n.childrenPending &&
					expanded.has(n.path) &&
					!loadingDirsRef.current.has(n.path)
				) {
					pending.push(n.path);
				}
				if (n.children?.length) walk(n.children);
			}
		};
		walk(nodes);
		if (pending.length === 0) return;

		for (const path of pending) {
			loadingDirsRef.current.add(path);
		}
		setLoadingDirs(new Set(loadingDirsRef.current));

		void (async () => {
			for (const path of pending) {
				try {
					await onLoadDirChildren(path);
				} catch {
					// Parent surfaces errors via toast; clear loading so user can retry.
				} finally {
					loadingDirsRef.current.delete(path);
					setLoadingDirs(new Set(loadingDirsRef.current));
				}
			}
		})();
	}, [nodes, expanded, onLoadDirChildren]);

	// Expand parent folder when starting inline create (IDE-like).
	useEffect(() => {
		if (!createDraft || !vaultPath) return;
		const parent = createDraft.parentPath;
		if (pathKey(parent) === pathKey(vaultPath)) return;
		setExpanded((prev) => {
			if (prev.has(parent)) return prev;
			const next = new Set(prev);
			next.add(parent);
			return next;
		});
	}, [createDraft, vaultPath]);

	const collapseToDefault = useCallback(() => {
		suppressAutoRevealRef.current = true;
		const open = new Set<string>();
		// Only papers/ — list its children; do not expand org subfolders.
		collectPapersRootOnlyExpanded(nodes, open);
		setExpanded(open);
	}, [nodes]);

	const collapsePaths = useCallback(
		(paths: string[]) => {
			if (paths.length === 0) return;
			suppressAutoRevealRef.current = true;
			setExpanded((prev) => {
				let changed = false;
				const next = new Set(prev);
				for (const raw of paths) {
					if (isVirtualTreePath(raw)) continue;
					const node = byPathKey.get(pathKey(raw));
					const path =
						node?.path ?? raw.replace(/\\/g, "/").replace(/\/+$/, "");
					const isExpandableDir = Boolean(
						node && isTreeExpandableDirectory(node),
					);

					let folderToClose: string | null = null;
					if (isExpandableDir && next.has(path)) {
						folderToClose = path;
					} else {
						// Nearest ancestor that is currently expanded (root-ward list → last).
						const parents = ancestorPaths(path, vaultPath);
						for (let i = parents.length - 1; i >= 0; i--) {
							const parent = parents[i];
							if (!parent || !next.has(parent)) continue;
							const parentNode = byPathKey.get(pathKey(parent));
							if (parentNode && !isTreeExpandableDirectory(parentNode)) {
								continue;
							}
							folderToClose = parentNode?.path ?? parent;
							break;
						}
					}
					if (folderToClose && next.has(folderToClose)) {
						next.delete(folderToClose);
						changed = true;
					}
				}
				return changed ? next : prev;
			});
		},
		[byPathKey, vaultPath],
	);

	const expandAncestorsOf = useCallback(
		(target: string) => {
			if (isVirtualTreePath(target)) return;
			const parents = ancestorPaths(target, vaultPath);
			if (parents.length === 0) return;
			setExpanded((prev) => {
				let changed = false;
				const next = new Set(prev);
				for (const parent of parents) {
					const node = byPathKey.get(pathKey(parent));
					if (node?.kind !== "directory") continue;
					// Reveal notes and attachments; keep generated paper internals hidden.
					if (
						isPaperDirectory(node.path, node.children) &&
						!isUnderPaperAttachments(target, node.path) &&
						!visibleTreeChildren(node).some(
							(child) => pathKey(child.path) === pathKey(target),
						)
					) {
						continue;
					}
					if (!next.has(node.path)) {
						next.add(node.path);
						changed = true;
					}
				}
				return changed ? next : prev;
			});
		},
		[vaultPath, byPathKey],
	);

	const togglePath = useCallback((path: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	}, []);

	const setExpandedFromTree = useCallback(
		(next: Set<string>) => {
			if (next.size < expanded.size) suppressAutoRevealRef.current = true;
			setExpanded(next);
		},
		[expanded],
	);

	return {
		expanded,
		setExpanded,
		setExpandedFromTree,
		loadingDirs,
		collapseToDefault,
		collapsePaths,
		expandAncestorsOf,
		togglePath,
		suppressAutoRevealRef,
	};
}
