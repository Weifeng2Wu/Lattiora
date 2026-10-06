/**
 * Layout regions for one document, bucketed per page.
 *
 * Results live in `layoutAnalysisStore` (shared with the Figures rail and the
 * CLI-written sidecar); this hook only subscribes and derives. The two bucket
 * passes are whole-document (NMS / spurious-detection suppression), so they must
 * never run inside per-page render — scrolling re-renders every mounted page.
 */

import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import { EMPTY_LAYOUT_REGIONS_BY_PAGE } from "@/components/viewer/pdf/constants";
import { cloudRelative, subscribeCloudFiles } from "@/lib/cloud/files";
import {
	buildLayoutDocumentResult,
	getLayoutDocumentResult,
	hoverableLayoutRegionsByPage,
	layoutAnalysisStore,
	layoutDocumentKey,
	layoutSidecarPath,
	mergeCaptionsIntoHosts,
	type PdfLayoutRegion,
	rawLayoutRegionsByPage,
	readLayoutSidecar,
	setLayoutDocumentResult,
} from "@/lib/pdf/layout";

export type PdfLayoutRegions = {
	/** Figures rail header toggle; also drives the debug Eye overlay. */
	layoutOverlayVisible: boolean;
	/** Post-merge regions, flat (bulk translate walks the raw set instead). */
	layoutDocRegions: PdfLayoutRegion[] | null;
	/** Pre-merge detections, flat: the bulk-translate source. */
	layoutRawRegions: PdfLayoutRegion[] | null;
	/** Post-merge hover hit targets, bucketed by 0-based page index. */
	hoverableRegionsByPage: ReadonlyMap<number, PdfLayoutRegion[]>;
	/** Pre-merge detections for the debug Eye overlay, bucketed by page. */
	rawRegionsByPage: ReadonlyMap<number, PdfLayoutRegion[]>;
};

export function usePdfLayoutRegions(
	docId: string,
	paperAbsPath?: string | null,
): PdfLayoutRegions {
	// `byDocument` is keyed by the revision-stripped base id (the translation
	// pane seeds it from the source pane while each viewer mounts its own
	// `tab::r<n>`); `overlayVisible` stays raw — same-viewer writers only.
	const documentKey = layoutDocumentKey(docId);
	const sourceKey = documentKey.endsWith("::translation")
		? documentKey.slice(0, -"::translation".length)
		: documentKey;
	// Background parsing writes a sidecar even when the source panel lacks focus.
	// Subscribe before reading so a completion during mount cannot be missed.
	useEffect(() => {
		if (!paperAbsPath) return;
		let revision = 0;
		const refresh = async () => {
			const current = ++revision;
			const sidecar = await readLayoutSidecar(paperAbsPath);
			if (current !== revision || !sidecar) return;
			setLayoutDocumentResult(
				buildLayoutDocumentResult(
					sourceKey,
					mergeCaptionsIntoHosts([...sidecar.regions]),
					sidecar.regions,
				),
			);
		};
		const path = cloudRelative(layoutSidecarPath(paperAbsPath));
		const unsubscribe = subscribeCloudFiles((paths) => {
			if (paths.includes(path)) void refresh();
		});
		if (!getLayoutDocumentResult(sourceKey)) void refresh();
		return () => {
			revision++;
			unsubscribe();
		};
	}, [sourceKey, paperAbsPath]);
	// Follow the live source result: translation can open before parsing ends.
	const result = useStore(
		layoutAnalysisStore,
		(s) => s.byDocument[sourceKey] ?? s.byDocument[documentKey] ?? null,
	);
	/** Figures rail header toggles this; mirror into EmbedPDF plugin. */
	const layoutOverlayVisible = useStore(
		layoutAnalysisStore,
		(s) => s.overlayVisible[docId] ?? false,
	);
	/** Post-merge layout regions for hover hit targets (figures rail source). */
	const layoutDocRegions = result?.regions ?? null;
	/** Pre-merge detections for the debug Eye overlay (all model boxes). */
	const layoutRawRegions = result?.rawRegions ?? result?.regions ?? null;
	/**
	 * Hover hit targets and debug boxes, bucketed by page. Both passes are
	 * whole-document (NMS / spurious-detection suppression), so they must not run
	 * inside per-page render — scrolling re-renders every mounted page.
	 */
	const hoverableRegionsByPage = useMemo(
		() =>
			layoutDocRegions
				? hoverableLayoutRegionsByPage(layoutDocRegions)
				: EMPTY_LAYOUT_REGIONS_BY_PAGE,
		[layoutDocRegions],
	);
	const rawRegionsByPage = useMemo(
		() =>
			layoutOverlayVisible && layoutRawRegions
				? rawLayoutRegionsByPage(layoutRawRegions)
				: EMPTY_LAYOUT_REGIONS_BY_PAGE,
		[layoutOverlayVisible, layoutRawRegions],
	);

	return {
		layoutOverlayVisible,
		layoutDocRegions,
		layoutRawRegions,
		hoverableRegionsByPage,
		rawRegionsByPage,
	};
}
