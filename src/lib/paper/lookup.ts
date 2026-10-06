/**
 * Shared contracts and identifier classification for the original magic wand.
 * Browser execution lives in import-actions and lib/cloud/research.
 * @see docs/backend/identifier-lookup.md
 */

import type {
	SkillCandidate,
	SkillDiscovery,
	SkillImportResult,
} from "@/lib/core/bindings";

export type LookupAddResult = {
	paperDir: string;
	path: string;
	id: string;
	title: string;
	usedTranslator: boolean;
	translatorBaseUrl: string;
	/** Local PDF present after import download. */
	pdf?: boolean;
	/** Local TeX present after import download. */
	tex?: boolean;
	paperMd?: boolean;
	assetMessages?: string[];
	/** `deduped` = paper already existed (a local PDF was merged into it). */
	status?: "created" | "deduped" | "skipped";
	/** Placeholder metadata committed; a RecognizeMetadata job resolves the
	 *  real metadata (and renames the folder) in the background. */
	recognizePending?: boolean;
};

export type { SkillCandidate, SkillDiscovery, SkillImportResult };

/** One importable hit from a magic-wand title search. */
export type PaperSearchCandidate = {
	title: string;
	authors: string[];
	year?: number;
	venue?: string;
	doi?: string;
	arxivId?: string;
	citationCount?: number;
	url?: string;
	/** Text handed back to the identifier pipeline on confirm. */
	identifier: string;
	source: "s2" | "arxiv" | "crossref" | "translator";
};

export type PaperSearchGroup = {
	query: string;
	candidates: PaperSearchCandidate[];
};

/**
 * Frontend heuristic mirroring Host `classify_segment`: true when the input
 * is likely free text that will fall through to title search. Used to open
 * the picker with a shimmer before the Host round-trip returns.
 *
 * Prefer false negatives (dialog opens late) over false positives that flash
 * the picker for a real identifier import — but single non-id tokens like
 * "AlphaFold" are titles, matching Host.
 */
export function looksLikeTitleSearchQuery(input: string): boolean {
	const text = input.trim();
	if (!text) return false;
	// Skill sources keep spaces; never treat them as titles.
	if (
		/\bnpx\s+skills\b/i.test(text) ||
		/\bskills\.sh\b/i.test(text) ||
		/github\.com\/[^\s]+/i.test(text)
	) {
		return false;
	}

	const tokens = text.split(/\s+/).filter(Boolean);
	if (tokens.length <= 1) {
		return !looksLikeIdentifierToken(tokens[0] ?? text);
	}
	// Space-separated identifier lists stay on the identifier path.
	if (tokens.every(looksLikeIdentifierToken)) return false;
	return true;
}

function looksLikeIdentifierToken(token: string): boolean {
	const t = token.trim();
	if (!t) return false;
	if (/^https?:\/\//i.test(t)) return true;
	if (/^(doi:)?10\.\d{4,}/i.test(t)) return true;
	if (/^(arXiv:)?\d{4}\.\d{4,5}(v\d+)?$/i.test(t)) return true;
	if (/^(arXiv:)?[a-z-]+(\.[A-Z]{2})?\/\d{7}(v\d+)?$/i.test(t)) return true;
	if (/^PMID:?\d{1,9}$/i.test(t) || /^\d{1,8}$/.test(t)) return true;
	if (/^(978|979)[-\d]{10,}$/i.test(t) || /^\d{9}[\dXx]$/.test(t)) return true;
	if (/^\d{4}[A-Za-z]\S{14}$/.test(t)) return true; // ADS bibcode-ish
	return false;
}

export type LookupBatchAddResult = {
	imported: LookupAddResult[];
	skills: SkillImportResult[];
	skillCandidates: SkillDiscovery[];
	searchCandidates: PaperSearchGroup[];
	skipped: { raw: string; kind: string; value: string; reason: string }[];
	errors: string[];
};

export type LocalPdfImportResult = {
	papers: LookupAddResult[];
	/** `"<file>: <reason>"` for each PDF that failed to import. */
	errors: string[];
};

/** Structured fields fetched via identifier resolution (not user-edited). */
export type LocalPdfExtraMeta = {
	publication?: string;
	volume?: string;
	issue?: string;
	pages?: string;
	publisher?: string;
	issn?: string;
	language?: string;
	date?: string;
	abstract?: string;
};

/** Per-file metadata overrides for local PDF import (host recognizes when absent). */
export type LocalPdfImportEntry = {
	filePath: string;
	title?: string;
	authors?: string[];
	year?: number;
	doi?: string;
	arxivId?: string;
	extra?: LocalPdfExtraMeta;
};
