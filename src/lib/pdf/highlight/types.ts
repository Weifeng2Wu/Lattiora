/** PDF highlight annotation model. See docs/development/pdf-ask.md */

export type PdfHighlightRect = {
	/** 0–1 relative to page box */
	x: number;
	y: number;
	w: number;
	h: number;
};

export type PdfHighlight = {
	version: 1;
	/** marks/ discriminator */
	kind: "highlight";
	id: string;
	/** Vault-relative paper folder when known; else absolute hint */
	paperPath: string;
	createdAt: string;
	updatedAt: string;
	/** 1-based page number */
	page: number;
	/** Normalized rects covering the highlighted text */
	rects: PdfHighlightRect[];
	/** Highlighted source text */
	quote: string;
	/** Palette key (see pdf-highlight/palette); defaults to yellow when absent */
	color?: string;
	/** Zotero-style annotation note; non-empty means this highlight is an annotation */
	comment?: string;
};
