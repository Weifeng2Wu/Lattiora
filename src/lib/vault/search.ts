/**
 * Browser-local Markdown content and file-path search.
 * Powers the command palette's "In contents" tier (see command-palette.tsx).
 */

import { track } from "@/lib/activity";
import { cloudSearch } from "@/lib/cloud/wiki";

export type SearchHit = {
	/** Vault-relative md file, e.g. papers/x/NOTES.md */
	path: string;
	/** Vault-relative paper folder when the hit is inside papers/… */
	paperPath?: string;
	title: string;
	snippet: string;
	/** 1-based line of the first match (0 when unknown). */
	line: number;
	score: number;
};

export type VaultSearchResult = {
	hits: SearchHit[];
	truncated: boolean;
};

const EMPTY: VaultSearchResult = { hits: [], truncated: false };

/** Search the local working copy, including while offline. */
export async function searchVault(opts: {
	vaultPath: string;
	query: string;
	limit?: number;
}): Promise<VaultSearchResult> {
	const query = opts.query.trim();
	if (!query) return EMPTY;
	const wire = await cloudSearch(query, opts.limit);
	const result: VaultSearchResult = {
		truncated: wire.truncated,
		hits: wire.hits.map((hit) => ({
			...hit,
			paperPath: hit.paperPath ?? undefined,
		})),
	};
	track("search.query", {
		extra: { q: query, hits: result.hits.length, truncated: result.truncated },
	});
	return result;
}
