/**
 * arXiv URL conventions (see https://info.arxiv.org/help/api/basics.html
 * and https://info.arxiv.org/about/accessible_HTML.html).
 *
 * | Resource | Pattern |
 * |----------|---------|
 * | Abstract | https://arxiv.org/abs/{id} |
 * | PDF      | https://arxiv.org/pdf/{id}  (also …/pdf/{id}.pdf) |
 * | HTML     | https://arxiv.org/html/{id} (experimental; backfill ongoing) |
 * | Source   | https://arxiv.org/e-print/{id} or /src/{id} |
 *
 * API Atom links use the same shapes; prefer export.arxiv.org only for bulk.
 * PDF/HTML responses currently send `Access-Control-Allow-Origin: *`, so
 * desktop WebView can load them for preview without a proxy.
 */

const ARXIV_ID_RE =
	/^(?:arXiv:)?((?:\d{4}\.\d{4,5})(?:v\d+)?|(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?)$/i;

/** Normalize user/API id → bare arXiv id (keeps version suffix if present). */
export function normalizeArxivId(raw: string): string | null {
	const s = raw
		.trim()
		.replace(
			/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf|html|src|e-print)\//i,
			"",
		);
	const cleaned = s.replace(/\.pdf$/i, "").replace(/\/$/, "");
	const m = cleaned.match(ARXIV_ID_RE);
	return m ? m[1] : null;
}

export type ArxivUrls = {
	id: string;
	abs: string;
	pdf: string;
	html: string;
	source: string;
};

/** Build canonical browse URLs from an arXiv id. */
export function arxivUrls(arxivId: string): ArxivUrls | null {
	const id = normalizeArxivId(arxivId);
	if (!id) return null;
	// Prefer unversioned id for stable links (arxiv resolves to latest).
	const bare = id.replace(/v\d+$/i, "");
	return {
		id: bare,
		abs: `https://arxiv.org/abs/${bare}`,
		pdf: `https://arxiv.org/pdf/${bare}`,
		html: `https://arxiv.org/html/${bare}`,
		source: `https://arxiv.org/src/${bare}`,
	};
}
