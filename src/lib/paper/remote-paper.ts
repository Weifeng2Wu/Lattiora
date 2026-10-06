/**
 * Remote paper preview — papers that have not been imported into the local Vault.
 *
 * Used by Plaza / arXiv Daily to open a PDF straight from its public URL without
 * downloading files. The metadata is held only in memory; closing the app drops
 * these tabs (they are filtered out of session persistence).
 */

import { arxivUrls } from "@/lib/paper/arxiv";
import type { PaperMetadata } from "@/lib/paper/types";

export const REMOTE_ARXIV_PREFIX = "agentero:arxiv:";

export type RemotePaperItem = {
	arxivId: string;
	title: string;
	abstract?: string;
	url: string;
	score?: number | null;
};

const cache = new Map<string, PaperMetadata>();

export function isRemoteArxivPath(path: string | null | undefined): boolean {
	if (!path) return false;
	return path.startsWith(REMOTE_ARXIV_PREFIX);
}

export function remoteArxivIdFromPath(path: string): string | null {
	if (!isRemoteArxivPath(path)) return null;
	return path.slice(REMOTE_ARXIV_PREFIX.length) || null;
}

export function remoteArxivPath(arxivId: string): string {
	return `${REMOTE_ARXIV_PREFIX}${arxivId}`;
}

/** Build a minimal read-only {@link PaperMetadata} from a remote arXiv item. */
export function stageRemoteArxivPaper(item: RemotePaperItem): PaperMetadata {
	const urls = arxivUrls(item.arxivId);
	const now = new Date().toISOString();
	const meta: PaperMetadata = {
		// Empty `path` is the Rust-side sentinel for "no vault folder yet";
		// a remote preview is never a catalog row.
		path: "",
		id: item.arxivId,
		type: "arxiv",
		title: item.title,
		abstract: item.abstract,
		authors: [],
		tags: [],
		status: "completed",
		is_read: false,
		arxiv_id: item.arxivId,
		source_url: item.url,
		pdf_url: urls?.pdf ?? undefined,
		html_url: urls?.html ?? undefined,
		added_at: now,
		updated_at: now,
	};
	cache.set(item.arxivId, meta);
	return meta;
}

export function getRemoteArxivPaper(arxivId: string): PaperMetadata | null {
	return cache.get(arxivId) ?? null;
}

export function getRemoteArxivPaperByPath(path: string): PaperMetadata | null {
	const id = remoteArxivIdFromPath(path);
	if (!id) return null;
	return getRemoteArxivPaper(id);
}
