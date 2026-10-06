import { normalizePath } from "@/lib/core/path";
import { isPaperAttachmentsDirName } from "@/lib/paper/paths";
import type { FileNode } from "@/lib/vault/types";

type NamedChild = {
	name: string;
	kind?: string;
	path?: string;
	children?: NamedChild[];
	childrenPending?: boolean;
};

/** Direct `{paper}/attachments` directory node, if present. */
export function paperAttachmentsNode<T extends NamedChild>(
	paper: { children?: T[] } | null | undefined,
): T | null {
	if (!paper?.children?.length) return null;
	return (
		paper.children.find(
			(child) =>
				(child.kind === "directory" || !child.kind) &&
				isPaperAttachmentsDirName(child.name),
		) ?? null
	);
}

/**
 * Whether the paper row should show an expand chevron: `attachments/` exists
 * and has at least one listed child (or is still pending a listing).
 */
export function paperHasVisibleAttachments(
	paper: { children?: NamedChild[] } | null | undefined,
): boolean {
	const dir = paperAttachmentsNode(paper);
	if (!dir) return false;
	if (dir.childrenPending) return true;
	return (dir.children?.length ?? 0) > 0;
}

/** Surface children of `{paper}/attachments/` (the bucket itself is not shown). */
export function paperAttachmentChildren(paper: FileNode): FileNode[] {
	const dir = paperAttachmentsNode(paper);
	if (!dir || dir.kind === "file") return [];
	return (dir.children as FileNode[] | undefined) ?? [];
}

/**
 * Path is `{paper}/attachments` itself (the hidden bucket).
 * Not a visible tree row — highlight the paper instead.
 */
export function isPaperAttachmentsRoot(
	path: string | null,
	paperDir: string | null,
): boolean {
	if (!path || !paperDir) return false;
	return (
		normalizePath(path).toLowerCase() ===
		`${normalizePath(paperDir)}/attachments`.toLowerCase()
	);
}

/**
 * Path is a surfaced attachment (`{paper}/attachments/<child>…`).
 * The `attachments/` directory itself is not surfaced.
 */
export function isUnderPaperAttachments(
	path: string | null,
	paperDir: string | null,
): boolean {
	if (!path || !paperDir) return false;
	const prefix = `${normalizePath(paperDir)}/attachments/`;
	return normalizePath(path).toLowerCase().startsWith(prefix.toLowerCase());
}
