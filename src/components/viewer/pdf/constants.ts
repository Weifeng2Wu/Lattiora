/**
 * Raster caps and stable identities shared by every rendered PDF page.
 *
 * The empty collections and the layer style must be module-level singletons:
 * page subtrees are memoized, and a fresh literal per render would defeat the
 * bail-out for every mounted page on every scroll frame.
 */

import type { PdfLinkAnnoObject } from "@embedpdf/models";
import type { CSSProperties } from "react";
import type { PageAnnotationComment } from "@/components/viewer/pdf/types";
import type { PdfLayoutRegion } from "@/lib/pdf/layout";
import type { SelectionPin } from "@/lib/pdf/selection";

/**
 * Full devicePixelRatio rasters make every zoom step expensive (PDFium
 * renders in a single worker shared by all pages), so the whole-page base
 * coat keeps a low dpr cap — it sits under the sharp tile layer anyway.
 */
const PDF_RASTER_DPR_CAP = 1.5;

export function pdfRasterDpr(): number {
	const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
	return Math.min(dpr, PDF_RASTER_DPR_CAP);
}

/**
 * The TilingLayer is the layer users actually read: tiles cover only the
 * viewport plus one ring, so letting them rasterize at (near-)native dpr
 * keeps small text sharp on HiDPI screens at a bounded cost. Capped at 2 so
 * 3× displays don't explode per-tile WASM work.
 */
const PDF_TILE_DPR_CAP = 2;

export function pdfTileDpr(): number {
	const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
	return Math.min(dpr, PDF_TILE_DPR_CAP);
}

/**
 * RenderLayer is only the base coat under the sharp TilingLayer — cap its
 * scale so zooming past this never re-rasterizes whole pages (the single
 * worker serializes renders; on long documents full-page rasters at high
 * zoom plus their blob transfers dominate). Tiles keep the viewport sharp.
 */
export const PDF_BASE_LAYER_SCALE_CAP = 1.5;

export const EMPTY_LAYOUT_REGIONS_BY_PAGE: ReadonlyMap<
	number,
	PdfLayoutRegion[]
> = new Map();

export const EMPTY_PINS: SelectionPin[] = [];

export const EMPTY_COMMENTS: PageAnnotationComment[] = [];

export const EMPTY_CITATION_LINKS: PdfLinkAnnoObject[] = [];

export const PAGE_LAYER_STYLE: CSSProperties = {
	position: "absolute",
	inset: 0,
};
