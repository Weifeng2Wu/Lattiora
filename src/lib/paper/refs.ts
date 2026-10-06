/**
 * Paper reference (citation) sidecar helpers.
 * Browser parsers and Worker S2/Crossref enrichment produce
 * the rebuildable `{paper}/source/agentero-cite.json`; see docs/backend/api.md
 * `paper_refs_parse` / `paper_refs_list`.
 */

export type {
	Citation,
	CitationLocalMatch,
	CitationMeta,
	CiteSidecar,
} from "@/lib/cloud/reference-types";

import i18n from "@/i18n";
import { cloudAiError } from "@/lib/cloud/ai";
import type { Citation, CiteSidecar } from "@/lib/cloud/reference-types";
import {
	parseCloudReferences,
	readCloudReferences,
} from "@/lib/cloud/references";
import { notifyError } from "@/lib/core/notify";
import { runLocalActivity } from "@/lib/core/tasks";

/** Read the existing reference sidecar; `null` when not parsed yet. */
export async function paperRefsList(
	vaultPath: string,
	path: string,
): Promise<CiteSidecar | null> {
	void vaultPath;
	return readCloudReferences(path);
}

/** Parse (or force-refresh) references for one paper and persist the sidecar. */
export async function paperRefsParse(
	vaultPath: string,
	path: string,
	force = false,
): Promise<CiteSidecar> {
	void vaultPath;
	return runLocalActivity(
		{ kind: "parseRefs", title: i18n.t("app:tasks.parseRefs") },
		async ({ signal }) => {
			const result = await parseCloudReferences(path, force, signal);
			for (const message of result.messages)
				if (message === "referencesOnlineUnavailable")
					notifyError(cloudAiError(new Error(message)));
			return result;
		},
	);
}

/** Read cached references or run a browser background parse when missing. */
export async function loadPaperRefsReadOnly(
	vaultPath: string,
	path: string,
): Promise<CiteSidecar | null> {
	const sidecar = await paperRefsList(vaultPath, path);
	return sidecar ?? paperRefsParse(vaultPath, path);
}

/** A new paper that cites the library but is not imported yet. */
export type CitingCandidate = {
	s2Id: string;
	title: string;
	date: string;
	arxivId?: string;
	doi?: string;
	/** Ready for `lookupSubmit`: `arXiv:{id}` or a bare DOI. */
	identifier: string;
	/** Vault-relative paths of my papers this candidate cites. */
	citedByMine: string[];
	/** IDF-weighted overlap; the primary ranking signal. */
	weight: number;
	similarity?: number;
	citationCount: number;
	oaPdfUrl?: string;
};

export type CitingScanResult = {
	generatedAt: string;
	sinceDate: string;
	libraryTotal: number;
	seedsTotal: number;
	seedsFetched: number;
	skippedMegaCited: number;
	skippedUncited: number;
	skippedUnknown: number;
	rawCiting: number;
	afterFilters: number;
	gatePassed: number;
	similarityThreshold?: number;
	candidates: CitingCandidate[];
	cancelled: boolean;
	messages: string[];
};

/**
 * Reverse citations — who cites *my* library. The opposite direction from the
 * rest of this module, and online-only: local TeX/`.bbl` cannot know it.
 *
 * Browser activity owns progress and cancellation; cached results are available offline.
 */
export async function libraryCitingScan(
	vaultPath: string,
	opts: {
		taskId?: string;
		sinceDays?: number;
		budget?: number;
		force?: boolean;
	} = {},
): Promise<CitingScanResult> {
	void vaultPath;
	const { scanCloudCiting } = await import("@/lib/cloud/citing");
	return runLocalActivity(
		{ kind: "citingScan", title: i18n.t("app:tasks.citingScan") },
		async ({ signal, setProgress }) =>
			scanCloudCiting(opts, signal, setProgress),
	);
}

/** Identifier usable by magic-wand import for an unmatched citation. */
export function citationImportIdentifier(citation: Citation): string | null {
	const { arxivId, doi } = citation.metadata;
	if (arxivId?.trim()) return `arXiv:${arxivId.trim()}`;
	if (doi?.trim()) return doi.trim();
	return null;
}

/** Best external link for a citation: url → DOI resolver → arXiv abs page. */
export function citationExternalUrl(citation: Citation): string | null {
	const { url, doi, arxivId } = citation.metadata;
	if (url?.trim()) return url.trim();
	if (doi?.trim()) return `https://doi.org/${doi.trim()}`;
	if (arxivId?.trim()) return `https://arxiv.org/abs/${arxivId.trim()}`;
	return null;
}
