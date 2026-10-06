/**
 * Cross-reference (`\ref`) hover preview for the EmbedPDF viewer: hovering a
 * "Fig. 3" / "Table 1" / "Eq. (2)" link shows a crop of the figure / table /
 * equation it points at.
 *
 * Resolution order (see `lib/pdf/citation-dest-keys`):
 * 1. Unambiguous dest coordinate → kind (standard hyperref `/XYZ`).
 * 2. Link annotation rect → dest label (`mk:tbl1` / `mk:fig3`) — needed when
 *    ACS `/FitR` destinations share a whole page across every float.
 * 3. Single label at the dest coordinate, or link-text extraction + caption
 *    match as a last resort.
 * Layout analysis supplies the region bbox; the crop is rendered on demand.
 * Links the maps or layout cannot resolve show nothing.
 *
 * Its own hook because the preview is a self-contained hover state machine that
 * runs an async crop — kept separate from `usePdfCitations` (citations resolve
 * synchronously to a sidecar entry). A coordinate is either a `cite.*` or a
 * cross-reference destination, never both, so both hover handlers can run on
 * the same link and at most one card appears.
 */

import type {
	PdfDocumentObject,
	PdfEngine,
	PdfLinkAnnoObject,
	PdfPageObject,
	Rect,
} from "@embedpdf/models";
import type { useDocumentManagerCapability } from "@embedpdf/plugin-document-manager/react";
import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { pageElByIndex, rectRightScreen } from "@/components/viewer/pdf/coords";
import { EPHEMERAL_PREVIEW_HIDE_MS } from "@/components/viewer/pdf/floating-hover";
import { useStickyHoverHide } from "@/components/viewer/pdf/hooks/use-sticky-hover-hide";
import { getLinkDestination } from "@/components/viewer/pdf/layers/citation-links";
import { renderPdfRegionPromptImage } from "@/components/viewer/pdf/region-crop";
import type { CrossrefPreviewState } from "@/components/viewer/pdf/types";
import {
	type CrossrefDestLabelMap,
	type CrossrefDestMap,
	type CrossrefKindMap,
	type CrossrefLinkLabelList,
	citationDestKey,
	matchCrossrefLinkLabel,
} from "@/lib/pdf/citation-dest-keys";
import { schedulePdfDestMapsBuild } from "@/lib/pdf/citation-dest-map";
import {
	extractCrossrefLabel,
	pickCrossrefRegion,
	pickCrossrefRegionByLabel,
} from "@/lib/pdf/crossref-resolve";
import { getLayoutDocumentResult } from "@/lib/pdf/layout";

/** Longest edge of the preview crop (px). */
const CROSSREF_CROP_MAX_EDGE = 520;

/** Whether two PDF rects overlap in page coordinates. */
function rectsOverlap(a: Rect, b: Rect): boolean {
	return (
		a.origin.x < b.origin.x + b.size.width &&
		a.origin.x + a.size.width > b.origin.x &&
		a.origin.y < b.origin.y + b.size.height &&
		a.origin.y + a.size.height > b.origin.y
	);
}

/**
 * Expand a rect by a small margin so adjacent text runs (e.g. "Table" and "1,")
 * are captured even if their bounding boxes only barely touch the link rect.
 */
function expandRect(rect: Rect, marginPt: number): Rect {
	return {
		origin: {
			x: rect.origin.x - marginPt,
			y: rect.origin.y - marginPt,
		},
		size: {
			width: rect.size.width + marginPt * 2,
			height: rect.size.height + marginPt * 2,
		},
	};
}

/**
 * Read the text covered by a link annotation's rect on a specific page. Used as
 * a fallback when the PDF destination only points at a page (ACS `/FitR`) so we
 * can infer "Figure 1" / "Table 1" from the link text itself.
 */
async function extractLinkText(
	engine: PdfEngine,
	document: PdfDocumentObject,
	page: PdfPageObject,
	linkRect: Rect,
): Promise<string> {
	const rects = await engine.getPageTextRects(document, page).toPromise();
	// Link rects from some publishers tightly enclose only part of a word or
	// omit adjacent punctuation/digits. A 2 pt margin catches "Table" + "1,"
	// without pulling in the surrounding sentence.
	const hitRect = expandRect(linkRect, 2);
	const overlapping = rects.filter((r) => rectsOverlap(r.rect, hitRect));
	// PDF coords: origin bottom-left; sort top-to-bottom for natural reading order.
	overlapping.sort((a, b) => b.rect.origin.y - a.rect.origin.y);
	return overlapping.map((r) => r.content).join(" ");
}

type DocumentManagerCapability = ReturnType<
	typeof useDocumentManagerCapability
>["provides"];

export type UsePdfCrossrefPreviewOptions = {
	docId: string;
	hostRef: RefObject<HTMLDivElement | null>;
	/** Current zoom, mirrored so the preview anchor never re-creates handlers. */
	zoomRef: RefObject<number>;
	/** Absolute paper folder; used to read PDF bytes for the dest map. */
	paperAbsPath: string | null;
	/** PDF bytes the viewer already holds; reused (copied) by the map build. */
	sourceBytes?: ArrayBuffer | null;
	/** Engine + document manager, for cropping the resolved region. */
	engineRef: RefObject<PdfEngine | null>;
	docCapRef: RefObject<DocumentManagerCapability>;
	/**
	 * Fired when a crossref card is about to show. Used by the viewer to clear
	 * sibling ephemeral overlays (citation preview).
	 */
	onPreviewShow?: () => void;
};

export type PdfCrossrefPreview = {
	crossrefPreview: CrossrefPreviewState | null;
	cancelCrossrefHide: () => void;
	scheduleCrossrefHide: () => void;
	/** Keep the card open while the pointer is over it. */
	markCrossrefHoverEnter: () => void;
	/** Drop the preview immediately (overlay exclusivity / suppress). */
	clearCrossrefPreview: () => void;
	handleCrossrefLinkHover: (link: PdfLinkAnnoObject | null) => void;
};

export function usePdfCrossrefPreview({
	docId,
	hostRef,
	zoomRef,
	paperAbsPath,
	sourceBytes = null,
	engineRef,
	docCapRef,
	onPreviewShow,
}: UsePdfCrossrefPreviewOptions): PdfCrossrefPreview {
	const onPreviewShowRef = useRef(onPreviewShow);
	onPreviewShowRef.current = onPreviewShow;
	const [crossrefPreview, setCrossrefPreview] =
		useState<CrossrefPreviewState | null>(null);
	const hideCrossrefPreview = useCallback(() => setCrossrefPreview(null), []);
	/**
	 * Leave link / card. Delay so the pointer can bridge into the card; never
	 * dismiss while the card is still hovered / focused.
	 */
	const {
		hoverSurfaceRef: crossrefHoverSurfaceRef,
		cancelHide: cancelCrossrefHide,
		markHoverEnter: markCrossrefHoverEnter,
		scheduleHide: scheduleCrossrefHide,
	} = useStickyHoverHide({
		delayMs: EPHEMERAL_PREVIEW_HIDE_MS,
		hide: hideCrossrefPreview,
	});
	/** hyperref cross-reference destinations of the open PDF, by coords. */
	const crossrefMapRef = useRef<CrossrefDestMap | null>(null);
	/**
	 * All cross-reference kinds found at each coordinate. Used as a fallback when
	 * the unambiguous map drops a coordinate because multiple kinds share it
	 * (e.g. ACS `/FitR` destinations pointing at a whole page).
	 */
	const crossrefKindsRef = useRef<CrossrefKindMap | null>(null);
	/**
	 * Parsed kind + number from each named destination at the coordinate. More
	 * reliable than link-text extraction for publisher-specific names like ACS
	 * `mk:fig1` / `mk:tbl1` when `/FitR` targets share a whole page.
	 */
	const crossrefLabelsRef = useRef<CrossrefDestLabelMap | null>(null);
	/**
	 * Link annotation rect → label. Exact for ACS `/FitR` collisions where the
	 * destination coordinate is shared by every float on the page — the link's
	 * own dest name (`mk:tbl1` / `mk:fig3`) still uniquely identifies the float.
	 */
	const crossrefLinksRef = useRef<CrossrefLinkLabelList | null>(null);
	/** Monotonic token so a stale crop never lands over a newer hover. */
	const renderTokenRef = useRef(0);

	const sourceBytesRef = useRef<ArrayBuffer | null>(sourceBytes);
	sourceBytesRef.current = sourceBytes;

	useEffect(() => {
		crossrefMapRef.current = null;
		crossrefKindsRef.current = null;
		crossrefLabelsRef.current = null;
		crossrefLinksRef.current = null;
		if (!paperAbsPath) return;
		return schedulePdfDestMapsBuild({
			paperAbsPath,
			viewerBytes: () => sourceBytesRef.current,
			warnLabel: "crossref dest map failed",
			onMaps: (maps) => {
				crossrefMapRef.current = maps.crossrefs;
				crossrefKindsRef.current = maps.crossrefKinds;
				crossrefLabelsRef.current = maps.crossrefLabels;
				crossrefLinksRef.current = maps.crossrefLinks;
			},
		});
	}, [paperAbsPath]);

	// Reset the preview when the active PDF document changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: docId is the effect trigger, not a value read inside the effect.
	useEffect(() => {
		crossrefHoverSurfaceRef.current = false;
		setCrossrefPreview(null);
	}, [docId]);

	const clearCrossrefPreview = useCallback(() => {
		cancelCrossrefHide();
		crossrefHoverSurfaceRef.current = false;
		// Invalidate in-flight crops so a stale resolve cannot remount the card.
		renderTokenRef.current += 1;
		setCrossrefPreview(null);
	}, [cancelCrossrefHide, crossrefHoverSurfaceRef]);

	const showPreview = useCallback(
		(
			link: PdfLinkAnnoObject,
			region: {
				pageIndex: number;
				bbox: { x: number; y: number; w: number; h: number };
			},
			kind: import("@/lib/pdf/citation-dest-keys").CrossrefKind,
		) => {
			cancelCrossrefHide();
			// Treat show as an active hover surface so mount-under-cursor skips
			// pointerenter do not auto-close.
			crossrefHoverSurfaceRef.current = true;
			const pageEl = pageElByIndex(hostRef.current, link.pageIndex);
			if (!pageEl) return;
			onPreviewShowRef.current?.();
			setCrossrefPreview({
				screen: rectRightScreen(pageEl, link.rect, zoomRef.current),
				kind,
				page: region.pageIndex + 1,
				region: region.bbox,
				image: null,
			});

			// Crop the region asynchronously; drop the result if a newer hover
			// (or a document close) superseded it.
			const token = ++renderTokenRef.current;
			const engine = engineRef.current;
			const document = docCapRef.current?.getDocument(docId) ?? null;
			if (!engine || !document) return;
			void renderPdfRegionPromptImage({
				engine,
				document,
				pageIndex: region.pageIndex,
				region: region.bbox,
				maxEdgePx: CROSSREF_CROP_MAX_EDGE,
			})
				.then((image) => {
					if (renderTokenRef.current !== token) return;
					setCrossrefPreview((prev) =>
						prev && prev.image === null ? { ...prev, image } : prev,
					);
				})
				.catch(() => {});
		},
		[
			docId,
			hostRef,
			zoomRef,
			engineRef,
			docCapRef,
			cancelCrossrefHide,
			crossrefHoverSurfaceRef,
		],
	);

	const handleCrossrefLinkHover = useCallback(
		(link: PdfLinkAnnoObject | null) => {
			if (!link) {
				scheduleCrossrefHide();
				return;
			}
			const destination = getLinkDestination(link.target);
			if (!destination) {
				scheduleCrossrefHide();
				return;
			}

			const coord = citationDestKey(destination.pageIndex, destination.pdfY);
			const regions = getLayoutDocumentResult(docId)?.regions ?? [];
			const document = docCapRef.current?.getDocument(docId) ?? null;
			const pageHeightPt =
				document?.pages[destination.pageIndex]?.size.height ?? null;

			// Fast path: unambiguous destination (standard hyperref /XYZ).
			const unambiguousKind = crossrefMapRef.current?.get(coord);
			if (unambiguousKind) {
				const region = pickCrossrefRegion(
					regions,
					destination.pageIndex,
					destination.pdfY,
					pageHeightPt,
					unambiguousKind,
				);
				if (region) {
					showPreview(link, region, unambiguousKind);
					return;
				}
			}

			// ACS `/FitR` (and similar): destination coords collide across every
			// float on the page. Recover the label from the *link annotation's*
			// dest name (`mk:tbl1` / `mk:fig3`) via its device-space rect — this
			// does not depend on fragile link-text extraction.
			const linkLabel = matchCrossrefLinkLabel(
				crossrefLinksRef.current,
				link.pageIndex,
				link.rect,
			);
			if (linkLabel) {
				const region = pickCrossrefRegionByLabel(
					regions,
					destination.pageIndex,
					linkLabel,
				);
				if (region) {
					showPreview(link, region, linkLabel.kind);
					return;
				}
			}

			// Fallback: ambiguous or page-only destination without a link-name
			// hit. Infer the kind/number from the link text and match layout
			// regions by caption title.
			const kinds = crossrefKindsRef.current?.get(coord);
			if (!kinds || kinds.length === 0) {
				scheduleCrossrefHide();
				return;
			}

			// If the destination name itself embeds an unambiguous label (e.g.
			// ACS `mk:fig1` / `mk:tbl1`) and it is the only label at this
			// coordinate, skip text extraction entirely.
			const labels = crossrefLabelsRef.current?.get(coord);
			if (labels && labels.length === 1) {
				const label = labels[0];
				const region = pickCrossrefRegionByLabel(
					regions,
					destination.pageIndex,
					label,
				);
				if (region) {
					showPreview(link, region, label.kind);
					return;
				}
			}

			const engine = engineRef.current;
			const page = document?.pages[link.pageIndex];
			if (!engine || !document || !page) {
				// No text extraction possible; if there is only one kind at this
				// coordinate, make a best-effort region guess.
				if (kinds.length === 1) {
					const region = pickCrossrefRegion(
						regions,
						destination.pageIndex,
						destination.pdfY,
						pageHeightPt,
						kinds[0],
					);
					if (region) {
						showPreview(link, region, kinds[0]);
						return;
					}
				}
				scheduleCrossrefHide();
				return;
			}

			cancelCrossrefHide();
			// Keep the card empty/spinner-free until the async resolution lands.
			const token = ++renderTokenRef.current;
			void extractLinkText(engine, document, page, link.rect)
				.then((text) => {
					if (renderTokenRef.current !== token) return;
					const label = extractCrossrefLabel(text);
					if (!label) {
						scheduleCrossrefHide();
						return;
					}
					if (!kinds.includes(label.kind)) {
						scheduleCrossrefHide();
						return;
					}
					const region = pickCrossrefRegionByLabel(
						regions,
						destination.pageIndex,
						label,
					);
					if (!region) {
						scheduleCrossrefHide();
						return;
					}
					showPreview(link, region, label.kind);
				})
				.catch(() => {
					if (renderTokenRef.current !== token) return;
					scheduleCrossrefHide();
				});
		},
		[
			docId,
			engineRef,
			docCapRef,
			cancelCrossrefHide,
			scheduleCrossrefHide,
			showPreview,
		],
	);

	// Clean up the hide timer when the document changes or unmounts.
	// biome-ignore lint/correctness/useExhaustiveDependencies: docId is the effect trigger, not a value read inside the cleanup.
	useEffect(
		() => () => {
			cancelCrossrefHide();
		},
		[docId, cancelCrossrefHide],
	);

	return {
		crossrefPreview,
		cancelCrossrefHide,
		scheduleCrossrefHide,
		markCrossrefHoverEnter,
		clearCrossrefPreview,
		handleCrossrefLinkHover,
	};
}
