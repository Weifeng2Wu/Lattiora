import { useMemo } from "react";

import { normalizePath } from "@/lib/core/path";
import { isPaperDirectory } from "@/lib/paper";
import { type FileNode, vaultRelativePath } from "@/lib/vault";

/**
 * Returns the vault-relative organization folders under `papers/`
 * (including the `papers` root itself), excluding individual paper folders
 * and any paths passed as `excludePaths`.
 */
export function usePapersOrgFolders(
	vaultPath: string | null,
	nodes: FileNode[],
	excludePaths?: string[],
): string[] {
	return useMemo(() => {
		const out = ["papers"];
		if (!vaultPath) return out;

		const excluded = (excludePaths ?? []).map((p) => normalizePath(p));
		const walk = (list: FileNode[]) => {
			for (const n of list) {
				if (n.kind !== "directory") continue;
				if (isPaperDirectory(n.path, n.children)) continue;

				const norm = normalizePath(n.path);
				const rel = vaultRelativePath(vaultPath, n.path);
				const under = rel && (rel === "papers" || rel.startsWith("papers/"));
				const isExcludedOrChild = excluded.some(
					(s) => norm === s || norm.startsWith(`${s}/`),
				);

				if (under && rel !== "papers" && !isExcludedOrChild) out.push(rel);
				if (n.children?.length) walk(n.children);
			}
		};

		walk(nodes);
		return Array.from(new Set(out));
	}, [vaultPath, nodes, excludePaths]);
}
