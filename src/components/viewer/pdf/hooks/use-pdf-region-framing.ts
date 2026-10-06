/**
 * Region framing (⌘. marquee) and the crop that turns a framed region into a
 * draft card.
 *
 * Split from {@link usePdfVisualMarks} because it is a different lifecycle: an
 * armed input mode plus one in-flight PDFium crop, with no knowledge of marks,
 * agents or persistence. It produces a draft and hands it to
 * {@link usePdfVisualDraft}, which owns the draft state.
 */

import type { PdfEngine } from "@embedpdf/models";
import type { useDocumentManagerCapability } from "@embedpdf/plugin-document-manager/react";
import type { useInteractionManagerCapability } from "@embedpdf/plugin-interaction-manager/react";
import type { useSelectionCapability } from "@embedpdf/plugin-selection/react";
import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { isPdfDocumentCloseRaceError } from "@/components/viewer/pdf/host-dom";
import { renderPdfRegionPromptImage } from "@/components/viewer/pdf/region-crop";
import type {
	ScreenPoint,
	SelectionMenuState,
	VisualDraftEditorState,
} from "@/components/viewer/pdf/types";
import { notifyError } from "@/lib/core/notify";
import type { PdfAskNormalizedRect } from "@/lib/pdf/ask/types";

type DocumentManagerCapability = ReturnType<
	typeof useDocumentManagerCapability
>["provides"];

type SelectionCapabilityProvides = ReturnType<
	typeof useSelectionCapability
>["provides"];

type InteractionManagerCapability = ReturnType<
	typeof useInteractionManagerCapability
>["provides"];

export type UsePdfRegionFramingOptions = {
	docId: string;
	/** Shared PDFium engine (null until the WASM host finished booting). */
	engine: PdfEngine | null;
	/** EmbedPDF capabilities; owned by `PdfViewerInner` (plugin context). */
	docCap: DocumentManagerCapability;
	selectionCap: SelectionCapabilityProvides;
	interactionCap: InteractionManagerCapability;
	/** Text-selection cluster: framing a region dismisses an open menu. */
	setSelectionMenu: Dispatch<SetStateAction<SelectionMenuState | null>>;
	/**
	 * Draft completion callback: persist the crop as a note-only visual mark and
	 * open it in the right-rail comment editor (#396).
	 */
	onVisualDraft: (draft: VisualDraftEditorState) => void;
	/** Screen anchor beside a page-normalized region (draft card placement). */
	screenPointForRegion: (
		pageIndex0: number,
		region: PdfAskNormalizedRect,
	) => ScreenPoint;
	/** True for PDFs outside papers/ (plain viewer): no visual annotation. */
	plainViewer?: boolean;
};

export type PdfRegionFraming = {
	/** Region framing (marquee) mode is armed. */
	regionSelecting: boolean;
	/** A crop is in flight; blocks re-entry. */
	visualCropPending: boolean;
	/**
	 * Region whose crop is in flight (null when idle). Rendered on the page so a
	 * click has a visible response before the draft card opens.
	 */
	visualCropRegion: { page: number; region: PdfAskNormalizedRect } | null;
	/** Enter / leave region framing. Shared by the toolbar and the handle (⌘.). */
	toggleRegionSelect: () => void;
	/** Crop a region and open the draft editor (does not send). */
	beginVisualAnnotation: (
		page: number,
		region: PdfAskNormalizedRect,
	) => Promise<void>;
	/** Marquee release on a page → crop that region. */
	handleVisualRegionSelect: (
		page: number,
		region: PdfAskNormalizedRect,
	) => void;
};

export function usePdfRegionFraming({
	docId,
	engine,
	docCap,
	selectionCap,
	interactionCap,
	setSelectionMenu,
	onVisualDraft,
	screenPointForRegion,
	plainViewer = false,
}: UsePdfRegionFramingOptions): PdfRegionFraming {
	const { t } = useTranslation("viewer");
	const [regionSelecting, setRegionSelecting] = useState(false);
	const [visualCropPending, setVisualCropPending] = useState(false);
	const [visualCropRegion, setVisualCropRegion] = useState<{
		page: number;
		region: PdfAskNormalizedRect;
	} | null>(null);
	/** Latest in-flight crop flag for the async guards below. */
	const visualCropPendingRef = useRef(visualCropPending);
	visualCropPendingRef.current = visualCropPending;

	// Disarm framing when the active PDF document changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: docId is the effect trigger, not a value read inside the effect.
	useEffect(() => {
		setRegionSelecting(false);
	}, [docId]);

	/** Enter/leave region framing. Shared by the toolbar and the handle. */
	const toggleRegionSelect = useCallback(() => {
		if (plainViewer || visualCropPendingRef.current) return;
		setSelectionMenu(null);
		selectionCap?.clear(docId);
		setRegionSelecting((active) => !active);
	}, [plainViewer, selectionCap, docId, setSelectionMenu]);

	/** Crop a region and hand it to the visual-mark cluster (#396). */
	const beginVisualAnnotation = useCallback(
		async (page: number, region: PdfAskNormalizedRect) => {
			if (plainViewer) return;
			if (!engine || !docCap || visualCropPendingRef.current) return;
			if (!docCap.isDocumentOpen(docId)) return;
			const document = docCap.getDocument(docId);
			if (!document) {
				notifyError(t("pdfExplain.cropFailed"));
				return;
			}
			setVisualCropPending(true);
			setVisualCropRegion({ page, region });
			setRegionSelecting(false);
			try {
				const image = await renderPdfRegionPromptImage({
					engine,
					document,
					pageIndex: page - 1,
					region,
				});
				if (!docCap.isDocumentOpen(docId)) return;
				const screen = screenPointForRegion(page - 1, region);
				onVisualDraft({
					screen,
					page,
					region,
					image,
				});
			} catch (error) {
				if (
					!docCap.isDocumentOpen(docId) ||
					isPdfDocumentCloseRaceError(error)
				) {
					return;
				}
				const message =
					error instanceof Error ? error.message : t("pdfExplain.cropFailed");
				notifyError(t("pdfExplain.cropFailed"), { description: message });
			} finally {
				setVisualCropPending(false);
				setVisualCropRegion(null);
			}
		},
		[
			plainViewer,
			engine,
			docCap,
			docId,
			t,
			onVisualDraft,
			screenPointForRegion,
		],
	);

	const handleVisualRegionSelect = useCallback(
		(page: number, region: PdfAskNormalizedRect) => {
			void beginVisualAnnotation(page, region);
		},
		[beginVisualAnnotation],
	);

	useEffect(() => {
		if (!regionSelecting) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			setRegionSelecting(false);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [regionSelecting]);

	// Region-select mode must not allow EmbedPDF text selection under the marquee.
	useEffect(() => {
		if (!regionSelecting) return;
		setSelectionMenu(null);
		selectionCap?.clear(docId);
		const scope = interactionCap?.forDocument(docId);
		scope?.pause();
		return () => {
			scope?.resume();
		};
	}, [regionSelecting, selectionCap, interactionCap, docId, setSelectionMenu]);

	return {
		regionSelecting,
		visualCropPending,
		visualCropRegion,
		toggleRegionSelect,
		beginVisualAnnotation,
		handleVisualRegionSelect,
	};
}
