/**
 * Shared PDF visual-context primitives (neutral seam between the `agent`
 * and `pdf` domains, P2-18 sink).
 *
 * Visual annotations (crop rects + trace/chat ids) are produced by the PDF
 * viewer and consumed by the Agent composer — and vice versa. These shared
 * primitives live here so neither domain owns them and neither imports the
 * other for them.
 */

/** Page-box-normalized selection/crop rect shared by PDF and Agent domains. */
export type PdfVisualNormalizedRect = {
	/** 0–1 relative to page box */
	x: number;
	y: number;
	w: number;
	h: number;
};
