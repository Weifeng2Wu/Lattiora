/**
 * Per-page layer stack rendered by EmbedPDF's `<Scroller renderPage>`: raster /
 * tiling / search / selection / annotation layers plus every Agentero overlay
 * (citation hits, layout boxes, bulk-translate text, mark source frames, gutter
 * pins).
 *
 * Memoized because the scroller re-renders every mounted page whenever its
 * layout changes; without a bail-out a single scroll frame rebuilds ten page
 * subtrees. Props are grouped into bundles the parent memoizes, so the shallow
 * comparison stays maintainable — a flat prop list would make it far too easy
 * to silently break memoization.
 */

import { useDocumentState } from "@embedpdf/core/react";
import {
	ignore,
	PdfAnnotationSubtype,
	PdfBlendMode,
	PdfErrorCode,
	type PdfHighlightAnnoObject,
	type PdfLinkAnnoObject,
	type Rotation,
} from "@embedpdf/models";
import {
	AnnotationLayer,
	type BoxedAnnotationRenderer,
	type useAnnotationCapability,
} from "@embedpdf/plugin-annotation/react";
import { PagePointerProvider } from "@embedpdf/plugin-interaction-manager/react";
import { LayoutAnalysisLayer } from "@embedpdf/plugin-layout-analysis/react";
import { useRenderCapability } from "@embedpdf/plugin-render/react";
import { SearchLayer } from "@embedpdf/plugin-search/react";
import { TilingLayer } from "@embedpdf/plugin-tiling/react";
import { EyeOff, Languages, Loader2 } from "lucide-react";
import {
	type CSSProperties,
	memo,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { PDF_CHROME_CHIP } from "@/components/viewer/pdf/chrome/pdf-chrome-surface";
import {
	EMPTY_CITATION_LINKS,
	EMPTY_COMMENTS,
	EMPTY_PINS,
	PAGE_LAYER_STYLE,
	PDF_BASE_LAYER_SCALE_CAP,
	pdfRasterDpr,
	pdfTileDpr,
} from "@/components/viewer/pdf/constants";
import { EMBED_PAGE_ATTR } from "@/components/viewer/pdf/coords";
import type { PdfTextLink } from "@/components/viewer/pdf/layers/citation-links";
import { CitationLinkLayer } from "@/components/viewer/pdf/layers/citation-links";
import { CommentCardsLayer } from "@/components/viewer/pdf/layers/comment-cards-layer";
import { HighlightAnnotationMenu } from "@/components/viewer/pdf/layers/highlight-annotation-menu";
import { LayoutTranslateOverlay } from "@/components/viewer/pdf/layers/layout-translate-overlay";
import { PdfTextSelectionLayer } from "@/components/viewer/pdf/layers/pdf-text-selection-layer";
import { PdfRegionSelectLayer } from "@/components/viewer/pdf/layers/region-select-layer";
import { SelectionGutter } from "@/components/viewer/pdf/layers/selection-gutter";
import { PDF_VISUAL_REGION_FRAME_CLASS } from "@/components/viewer/pdf/layers/visual-region-frame";
import type {
	PageAnnotationComment,
	SelectionCommentDraft,
} from "@/components/viewer/pdf/types";
import { cn } from "@/lib/core/utils";
import type { PdfVisualSessionTrace } from "@/lib/pdf/agent-trace";
import type { PdfAskNormalizedRect } from "@/lib/pdf/ask/types";
import {
	type HighlightColor,
	highlightHoverOverlayColor,
} from "@/lib/pdf/highlight/palette";
import {
	isLayoutRegionActivation,
	LAYOUT_HINT_MIN_REGION_H_PX,
	LAYOUT_HINT_MIN_REGION_W_PX,
	type LayoutTranslateItem,
	layoutKindBorder,
	layoutKindFill,
	layoutKindHex,
	layoutKindI18nKey,
	type PdfLayoutRegion,
	type PointerOrigin,
} from "@/lib/pdf/layout";
import {
	PDF_ANNOTATION_DARK_CLASS,
	PDF_PAGE_RASTER_DARK_CLASS,
	PDF_PAPER_SHELL_CLASS,
	PDF_PAPER_TINT,
	type PdfPaperTone,
} from "@/lib/pdf/page-theme";
import type { SelectionPin } from "@/lib/pdf/selection";

const PASSIVE_HIGHLIGHT_RENDERER: BoxedAnnotationRenderer = {
	id: "highlight",
	matches: (annotation) => annotation.type === PdfAnnotationSubtype.HIGHLIGHT,
	render: ({ currentObject, scale }) => {
		const highlight = currentObject as PdfHighlightAnnoObject;
		const rect = highlight.rect;
		const segments = highlight.segmentRects?.length
			? highlight.segmentRects
			: [rect];
		return (
			<>
				{segments.map((segment) => (
					<div
						key={`${highlight.id}-${segment.origin.x}-${segment.origin.y}-${segment.size.width}-${segment.size.height}`}
						aria-hidden="true"
						style={{
							position: "absolute",
							left: (segment.origin.x - rect.origin.x) * scale,
							top: (segment.origin.y - rect.origin.y) * scale,
							width: segment.size.width * scale,
							height: segment.size.height * scale,
							backgroundColor:
								highlight.strokeColor ?? highlight.color ?? "#fcd34d",
							opacity: highlight.opacity ?? 0.4,
							pointerEvents: "none",
						}}
					/>
				))}
			</>
		);
	},
	zIndex: 0,
	defaultBlendMode: PdfBlendMode.Multiply,
	interactionDefaults: {
		isDraggable: false,
		isResizable: false,
		isRotatable: false,
	},
	useAppearanceStream: false,
};

const PASSIVE_HIGHLIGHT_RENDERERS: BoxedAnnotationRenderer[] = [
	PASSIVE_HIGHLIGHT_RENDERER,
];

/**
 * Text-selection highlight tint: a light translucent blue (Zotero-style) so the
 * underlying glyphs stay legible under the selection. Module-level so every
 * page shares one stable value.
 */
const PDF_TEXT_SELECTION_BACKGROUND = "rgba(96, 165, 250, 0.28)";

/** A mark region pinned to a page (visual draft frame / formula legend frame). */
type PageRegion = { page: number; region: PdfAskNormalizedRect } | null;

type AgenteroRenderLayerProps = {
	documentId: string;
	pageIndex: number;
	scale?: number;
	dpr?: number;
	className?: string;
	style?: CSSProperties;
};

function pdfPageRenderRotation(
	documentState: ReturnType<typeof useDocumentState>,
	pageIndex: number,
): Rotation {
	// `normalizeRotation: true` reports the unrotated content-space size and
	// keeps /Rotate in `page.rotation`; the raster is only upright when the
	// caller re-applies it (see test/pdf-page-rotation.test.ts).
	const pageRotation = documentState?.document?.pages[pageIndex]?.rotation ?? 0;
	return ((((pageRotation + (documentState?.rotation ?? 0)) % 4) + 4) %
		4) as Rotation;
}

function AgenteroRenderLayer({
	documentId,
	pageIndex,
	scale: scaleOverride,
	dpr: dprOverride,
	className,
	style,
}: AgenteroRenderLayerProps) {
	const { provides: renderProvides } = useRenderCapability();
	const documentState = useDocumentState(documentId);
	const [imageUrl, setImageUrl] = useState<string | null>(null);
	const urlRef = useRef<string | null>(null);
	const refreshVersion = useMemo(() => {
		if (!documentState) return 0;
		return documentState.pageRefreshVersions[pageIndex] || 0;
	}, [documentState, pageIndex]);
	const actualScale = useMemo(() => {
		if (scaleOverride !== undefined) return scaleOverride;
		return documentState?.scale ?? 1;
	}, [scaleOverride, documentState?.scale]);
	const actualDpr = useMemo(() => {
		if (dprOverride !== undefined) return dprOverride;
		return window.devicePixelRatio;
	}, [dprOverride]);
	const rotation = useMemo(
		() => pdfPageRenderRotation(documentState, pageIndex),
		[documentState, pageIndex],
	);

	useEffect(() => {
		if (!renderProvides) return;
		void refreshVersion;
		const task = renderProvides.forDocument(documentId).renderPage({
			pageIndex,
			options: {
				scaleFactor: actualScale,
				dpr: actualDpr,
				rotation,
			},
		});
		task.wait((blob) => {
			const url = URL.createObjectURL(blob);
			setImageUrl(url);
			urlRef.current = url;
		}, ignore);
		return () => {
			if (urlRef.current) {
				URL.revokeObjectURL(urlRef.current);
				urlRef.current = null;
				return;
			}
			task.abort({
				code: PdfErrorCode.Cancelled,
				message: "canceled render task",
			});
		};
	}, [
		documentId,
		pageIndex,
		actualScale,
		actualDpr,
		rotation,
		renderProvides,
		refreshVersion,
	]);

	const handleImageLoad = () => {
		if (!urlRef.current) return;
		URL.revokeObjectURL(urlRef.current);
		urlRef.current = null;
	};

	if (!imageUrl) return null;
	return (
		<img
			src={imageUrl}
			alt=""
			aria-hidden="true"
			draggable={false}
			onLoad={handleImageLoad}
			className={className}
			style={{ width: "100%", height: "100%", ...style }}
		/>
	);
}

/**
 * Anchor geometry of an open ask / translate card. Anchor-only: it keeps its
 * identity while the card body streams, so the page layers skip re-rendering
 * per streamed chunk.
 */
export type PdfActiveCardAnchor = {
	id: string;
	/** 1-based page number */
	page: number;
	rects: PdfAskNormalizedRect[];
};

/** Marks and mark-derived overlays. Whole-document work, bucketed by page. */
export type PdfPageMarksSlice = {
	activeAskAnchor: PdfActiveCardAnchor | null;
	activeTranslateAnchor: PdfActiveCardAnchor | null;
	activeVisualTrace: PdfVisualSessionTrace | null;
	visualDraftRegion: PageRegion;
	/** Region whose crop is in flight; gets a spinner frame. */
	visualCropRegion: PageRegion;
	focusedLayoutRegion: PdfLayoutRegion | null;
	/** Citation jump: yellow flash that auto-clears (vs persistent figures selection). */
	focusedLayoutFlash: boolean;
	/** Restarts the flash CSS animation when the same region is jumped again. */
	focusedLayoutFlashToken: number;
	pinsByPage: ReadonlyMap<number, SelectionPin[]>;
	/** Annotated highlights per page for the right-edge comment rail. */
	commentsByPage: ReadonlyMap<number, PageAnnotationComment[]>;
	/** Comment currently being edited in the rail; null when idle. */
	editingCommentId: string | null;
	/** Resolvable wiki target for comment copy-link/copy-embed; null hides them. */
	commentWikiTarget: string | null;
	citationLinks: ReadonlyMap<number, PdfLinkAnnoObject[]>;
	textLinks: ReadonlyMap<number, PdfTextLink[]>;
	activeCardId: string | null;
	/** Id of the comment-rail card currently being hovered; null when idle. */
	hoveredCommentId: string | null;
	/**
	 * Sticky text-selection comment chip (right rail). Null when idle or on a
	 * read-only remote PDF.
	 */
	selectionCommentDraft: SelectionCommentDraft | null;
};

/** Layout-analysis derived overlays (hover targets, debug boxes, translations). */
export type PdfPageLayoutSlice = {
	hoverableRegionsByPage: ReadonlyMap<number, PdfLayoutRegion[]>;
	rawRegionsByPage: ReadonlyMap<number, PdfLayoutRegion[]>;
	layoutOverlayVisible: boolean;
	layoutTranslateItemsByPage: ReadonlyMap<
		number,
		readonly LayoutTranslateItem[]
	>;
	layoutTranslatePageStateByPage: ReadonlyMap<
		number,
		{ active: boolean; running: boolean }
	>;
};

/** Interaction modes that unmount or gate page layers. */
export type PdfPageModeSlice = {
	regionSelecting: boolean;
	visualCropPending: boolean;
	visualDraftOpen: boolean;
	/**
	 * Dual-pane translation companion: keep raster + translate overlay only.
	 * Selection / annotation / search / citation chrome stay unmounted.
	 */
	translationOnly?: boolean;
	/** PDFs outside papers/: annotation / translate / layout layers stay off. */
	plainViewer?: boolean;
};

export type PdfPageHandlers = {
	onOpenPin: (pin: SelectionPin) => void;
	onCardHoverEnter: () => void;
	onCardHoverLeave: () => void;
	onCitationActivate: (link: PdfLinkAnnoObject) => void;
	onTextLinkActivate: (url: string) => void;
	onCitationHover: (link: PdfLinkAnnoObject | null) => void;
	onRegionSelect: (page: number, region: PdfAskNormalizedRect) => void;
	/** Click a figure / table / algorithm / formula hit target → crop + draft card. */
	onLayoutRegionClick: (region: PdfLayoutRegion) => void;
	onTogglePageLayoutTranslate: (pageIndex: number) => void;
	/** Delete a highlight annotation directly from its on-page selection menu. */
	onDeleteHighlightAnnotation: (pageIndex: number, id: string) => void;
	/** Open the note editor for a highlight from its on-page selection menu. */
	onEditHighlightAnnotation: (id: string) => void;
	/** Change the color of a highlight annotation from its on-page selection menu. */
	onChangeHighlightColor: (
		pageIndex: number,
		id: string,
		color: HighlightColor,
	) => void;
	/** Start in-place edit on a comment-rail card. */
	onOpenComment: (comment: PageAnnotationComment) => void;
	/** Commit in-place edit on a comment-rail card. */
	onSaveComment: (comment: PageAnnotationComment, text: string) => void;
	/** Discard in-place edit (Escape). */
	onCancelComment: () => void;
	/** Delete a highlight / visual note from its comment-rail card. */
	onDeleteComment: (comment: PageAnnotationComment) => void;
	/** Copy the comment card's `[[target@id]]` wikilink. */
	onCopyCommentLink: (comment: PageAnnotationComment) => void;
	/** Copy the comment card's `![[target@id]]` embed. */
	onCopyCommentEmbed: (comment: PageAnnotationComment) => void;
	/** Add a visual comment's crop to the Agent sidebar composer (#396). */
	onAddCommentToChat: (comment: PageAnnotationComment) => void;
	/** Hover enters a comment-rail card. */
	onHoverComment: (comment: PageAnnotationComment) => void;
	/** Hover leaves a comment-rail card. */
	onLeaveComment: () => void;
	/** Commit a typed note from the selection comment chip. */
	onCommitSelectionComment: (comment: string) => void;
	/** Keep the sticky draft alive while the chip is interacted with. */
	onSelectionCommentActiveChange: (active: boolean) => void;
	/** Drop the sticky selection comment chip. */
	onDismissSelectionComment: () => void;
};

/**
 * EmbedPDF annotation capability. Passed in by the caller rather than read
 * with `useAnnotationCapability()` here: the slim dual-pane translation
 * viewer renders `PdfPageLayers` without registering the annotation plugin,
 * and that hook throws ("Plugin annotation not found") when the plugin is
 * absent — hooks run before the `mode.translationOnly` early return.
 */
type AnnotationCapabilityProvides = ReturnType<
	typeof useAnnotationCapability
>["provides"];

export type PdfPageLayersProps = {
	annotationSource?: string;
	docId: string;
	pageIndex: number;
	width: number;
	height: number;
	/** Paper tone for this viewer (process-wide preference). */
	tone: PdfPaperTone;
	/** Read at render time only; page width/height already track zoom. */
	zoomRef: RefObject<number>;
	/** EmbedPDF capability from the owning viewer; null in panes without the annotation plugin. */
	annotationCap: AnnotationCapabilityProvides;
	marks: PdfPageMarksSlice;
	layout: PdfPageLayoutSlice;
	mode: PdfPageModeSlice;
	handlers: PdfPageHandlers;
};

type PageTranslateTabProps = {
	pageIndex: number;
	active: boolean;
	running: boolean;
	onToggle: (pageIndex: number) => void;
};

/**
 * Page-edge translate tab — match PDF chrome (left toolbar / bottom bar):
 * Callout `text-xs`, `size-3.5` icons, `h-7`-wide hit target, shared surface.
 * Rem sizes keep Windows non-integer DPR from drifting the tab.
 */
function labelCharacters(label: string): { key: string; char: string }[] {
	const seen = new Map<string, number>();
	return Array.from(label, (char) => {
		const count = (seen.get(char) ?? 0) + 1;
		seen.set(char, count);
		return { key: `${char}-${count}`, char };
	});
}

const PageTranslateTab = memo(function PageTranslateTab({
	pageIndex,
	active,
	running,
	onToggle,
}: PageTranslateTabProps) {
	const { t } = useTranslation("viewer");
	const label = running
		? t("pdf.layoutTranslate.pageRunning")
		: active
			? t("pdf.layoutTranslate.hidePage")
			: t("pdf.layoutTranslate.translatePage");
	const shortLabel = active
		? t("pdf.layoutTranslate.hidePageShort")
		: t("pdf.layoutTranslate.translatePageShort");
	const Icon = running ? Loader2 : active ? EyeOff : Languages;
	return (
		<button
			type="button"
			data-pdf-chrome
			className={cn(
				"absolute top-3 left-0 z-[6] flex w-7 min-h-16 -translate-x-full flex-col items-center justify-center gap-1 rounded-l-lg border-r-0 px-1 py-2 font-medium text-xs text-foreground transition-colors duration-100 hover:bg-muted/80 active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
				PDF_CHROME_CHIP,
				active && "border-primary/30 bg-primary/10 text-primary",
			)}
			aria-label={label}
			aria-pressed={active}
			onClick={(event) => {
				event.preventDefault();
				event.stopPropagation();
				onToggle(pageIndex);
			}}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<Icon
				className={cn("size-3.5 shrink-0", running && "animate-spin")}
				aria-hidden="true"
			/>
			<span className="flex flex-col items-center gap-0.5 leading-none">
				{labelCharacters(shortLabel).map((part) => (
					<span key={part.key} className="block text-center">
						{part.char}
					</span>
				))}
			</span>
		</button>
	);
});

export const PdfPageLayers = memo(function PdfPageLayers({
	annotationSource,
	docId,
	pageIndex,
	width,
	height,
	tone,
	zoomRef,
	annotationCap,
	marks,
	layout,
	mode,
	handlers,
}: PdfPageLayersProps) {
	const { t } = useTranslation("viewer");
	const pdfDark = tone === "dark";
	const paperTint = PDF_PAPER_TINT[tone];
	const pageShellRef = useRef<HTMLDivElement | null>(null);
	/**
	 * Pointer position at the last pointerdown on a layout hit target. A click
	 * that travelled beyond the tolerance was a drag, not an activation.
	 */
	const pointerOriginRef = useRef<PointerOrigin | null>(null);
	const pageNumber = pageIndex + 1;
	const activeAskOnPage =
		marks.activeAskAnchor?.page === pageNumber ? marks.activeAskAnchor : null;
	const activeTranslateOnPage =
		marks.activeTranslateAnchor?.page === pageNumber
			? marks.activeTranslateAnchor
			: null;
	const activeVisualOnPage =
		marks.activeVisualTrace?.page === pageNumber
			? marks.activeVisualTrace
			: null;
	const visualDraftRegionOnPage =
		marks.visualDraftRegion?.page === pageNumber
			? marks.visualDraftRegion.region
			: null;
	const visualCropRegionOnPage =
		marks.visualCropRegion?.page === pageNumber
			? marks.visualCropRegion.region
			: null;
	const focusedLayoutOnPage =
		marks.focusedLayoutRegion?.pageIndex === pageIndex
			? marks.focusedLayoutRegion
			: null;
	const pins = marks.pinsByPage.get(pageNumber) ?? EMPTY_PINS;
	const comments = marks.commentsByPage.get(pageNumber) ?? EMPTY_COMMENTS;
	const selectionDraftOnPage =
		marks.selectionCommentDraft?.page === pageNumber
			? marks.selectionCommentDraft
			: null;
	const layoutTranslateOnPage =
		layout.layoutTranslateItemsByPage.get(pageIndex);
	const pageTranslateState = layout.layoutTranslatePageStateByPage.get(
		pageIndex,
	) ?? { active: false, running: false };
	const emphasizedCommentId = marks.hoveredCommentId ?? marks.editingCommentId;
	const emphasizedComment = emphasizedCommentId
		? (comments.find((c) => c.id === emphasizedCommentId) ?? null)
		: null;

	const textCommentAtPoint = (clientX: number, clientY: number) => {
		if (!comments.length) return null;
		const pageRect = pageShellRef.current?.getBoundingClientRect();
		if (!pageRect?.width || !pageRect.height) return null;
		const x = (clientX - pageRect.left) / pageRect.width;
		const y = (clientY - pageRect.top) / pageRect.height;
		if (x < 0 || x > 1 || y < 0 || y > 1) return null;
		return (
			comments.find(
				(comment) =>
					comment.kind !== "visual" &&
					comment.rects.some(
						(rect) =>
							x >= rect.x &&
							x <= rect.x + rect.w &&
							y >= rect.y &&
							y <= rect.y + rect.h,
					),
			) ?? null
		);
	};

	const highlightAtPoint = (clientX: number, clientY: number) => {
		const pageRect = pageShellRef.current?.getBoundingClientRect();
		if (!pageRect?.width || !pageRect.height || !annotationCap) return null;
		const pageX = ((clientX - pageRect.left) / pageRect.width) * width;
		const pageY = ((clientY - pageRect.top) / pageRect.height) * height;
		if (pageX < 0 || pageX > width || pageY < 0 || pageY > height) return null;
		const pageXPt = pageX / zoomRef.current;
		const pageYPt = pageY / zoomRef.current;
		const highlights = annotationCap
			.forDocument(docId)
			.getAnnotations()
			.map((annotation) => annotation.object)
			.filter(
				(annotation): annotation is PdfHighlightAnnoObject =>
					annotation.type === PdfAnnotationSubtype.HIGHLIGHT &&
					annotation.pageIndex === pageIndex,
			);
		return (
			highlights.find((highlight) => {
				const segments = highlight.segmentRects?.length
					? highlight.segmentRects
					: [highlight.rect];
				return segments.some(
					(rect) =>
						pageXPt >= rect.origin.x &&
						pageXPt <= rect.origin.x + rect.size.width &&
						pageYPt >= rect.origin.y &&
						pageYPt <= rect.origin.y + rect.size.height,
				);
			}) ?? null
		);
	};

	const handlePagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		if ((event.target as Element | null)?.closest("[data-pdf-chrome]")) return;
		const comment = textCommentAtPoint(event.clientX, event.clientY);
		if (comment?.id === marks.hoveredCommentId) return;
		if (comment) handlers.onHoverComment(comment);
		else if (marks.hoveredCommentId) handlers.onLeaveComment();
	};

	const handlePagePointerLeave = () => {
		if (marks.hoveredCommentId) handlers.onLeaveComment();
	};

	const handlePageClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
		if ((event.target as Element | null)?.closest("[data-pdf-chrome]")) return;
		if (window.getSelection()?.toString()) return;
		const comment = textCommentAtPoint(event.clientX, event.clientY);
		if (comment) {
			event.stopPropagation();
			handlers.onOpenComment(comment);
			return;
		}
		const highlight = highlightAtPoint(event.clientX, event.clientY);
		if (!highlight) return;
		event.stopPropagation();
		annotationCap?.forDocument(docId).selectAnnotation(pageIndex, highlight.id);
	};

	const paperRaster = (
		<div className="absolute inset-0 isolate">
			<AgenteroRenderLayer
				documentId={docId}
				pageIndex={pageIndex}
				scale={Math.min(zoomRef.current, PDF_BASE_LAYER_SCALE_CAP)}
				dpr={pdfRasterDpr()}
				className={pdfDark ? PDF_PAGE_RASTER_DARK_CLASS : undefined}
				style={PAGE_LAYER_STYLE}
			/>
			<TilingLayer
				documentId={docId}
				pageIndex={pageIndex}
				dpr={pdfTileDpr()}
				className={pdfDark ? PDF_PAGE_RASTER_DARK_CLASS : undefined}
				style={PAGE_LAYER_STYLE}
			/>
			{/*
			 * Tinted paper: multiply over the rasters only, so white paper lands on
			 * the tone while text stays black and figures keep their saturation.
			 * Painted below the interaction layers so highlights stay untouched.
			 */}
			{paperTint ? (
				<div
					aria-hidden
					className="pointer-events-none absolute inset-0 mix-blend-multiply"
					style={{ backgroundColor: paperTint }}
				/>
			) : null}
		</div>
	);

	const translateOverlay =
		layoutTranslateOnPage && layoutTranslateOnPage.length > 0 ? (
			<LayoutTranslateOverlay
				items={layoutTranslateOnPage}
				pageWidthPx={width}
				pageHeightPx={height}
				tone={tone}
				layoutRegions={layout.rawRegionsByPage.get(pageIndex)}
			/>
		) : null;

	// Dual-pane companion: raster + translated text only. Skipping the full
	// interaction stack halves per-page React work while the second EmbedPDF
	// instance is still warming up.
	if (mode.translationOnly) {
		return (
			<div
				className={cn(
					"relative overflow-visible rounded-sm shadow-sm ring-1",
					PDF_PAPER_SHELL_CLASS[tone],
				)}
				style={{ width, height }}
				{...{ [EMBED_PAGE_ATTR]: pageIndex }}
			>
				{paperRaster}
				{translateOverlay}
			</div>
		);
	}

	// Page shell: matches the finished paper so loading gaps do not flash a
	// different colour.
	return (
		<div
			ref={pageShellRef}
			data-annotation-pdf={docId}
			data-annotation-source={annotationSource}
			data-annotation-page={pageIndex + 1}
			className={cn(
				"relative overflow-visible rounded-sm shadow-sm ring-1",
				PDF_PAPER_SHELL_CLASS[tone],
			)}
			style={{ width, height }}
			onPointerMove={handlePagePointerMove}
			onPointerLeave={handlePagePointerLeave}
			onClickCapture={handlePageClickCapture}
			{...{ [EMBED_PAGE_ATTR]: pageIndex }}
		>
			{/*
			 * Paper group: rasters plus the tint that recolours them, isolated so the
			 * multiply blend reads only this page's paper and never the viewer
			 * backdrop. Isolation lives here rather than on the page shell so overlays
			 * that overflow the page (comment cards, translate tab, highlight menu)
			 * keep painting across page boundaries.
			 *
			 * EmbedPDF has no page color-scheme API yet (UI chrome theme only).
			 * Invert + hue-rotate only the raster layers so selection / search /
			 * annotation / pin overlays keep their intended colors. Agent crops
			 * use engine.renderPageRect and are unaffected.
			 */}
			{paperRaster}
			<SearchLayer
				documentId={docId}
				pageIndex={pageIndex}
				style={PAGE_LAYER_STYLE}
			/>
			{/*
			 * EmbedPDF raw bbox layer — kept mounted for plugin state, but
			 * visibility is forced off (see effect). Store-backed boxes below.
			 */}
			<LayoutAnalysisLayer
				documentId={docId}
				pageIndex={pageIndex}
				style={PAGE_LAYER_STYLE}
			/>
			<PagePointerProvider
				documentId={docId}
				pageIndex={pageIndex}
				style={PAGE_LAYER_STYLE}
			>
				{/* Unmount text selection while framing a visual region. */}
				{mode.regionSelecting ? null : (
					<PdfTextSelectionLayer
						documentId={docId}
						pageIndex={pageIndex}
						background={PDF_TEXT_SELECTION_BACKGROUND}
					/>
				)}
				{/*
				 * AnnotationLayer is not inverted with the page rasters. In PDF dark
				 * mode its bright highlight colors look glaring on dark paper, so
				 * dim/saturation-reduce the whole layer slightly. Link annotations
				 * are affected too but remain legible.
				 */}
				{!mode.plainViewer ? (
					<div
						className={cn(
							"absolute inset-0",
							pdfDark && PDF_ANNOTATION_DARK_CLASS,
						)}
					>
						<AnnotationLayer
							documentId={docId}
							pageIndex={pageIndex}
							annotationRenderers={PASSIVE_HIGHLIGHT_RENDERERS}
							selectionMenu={(menuProps) => (
								<HighlightAnnotationMenu
									{...menuProps}
									docId={docId}
									onEdit={handlers.onEditHighlightAnnotation}
									onDelete={handlers.onDeleteHighlightAnnotation}
									onChangeColor={handlers.onChangeHighlightColor}
								/>
							)}
						/>
					</div>
				) : null}
				{!mode.plainViewer ? (
					<PageTranslateTab
						pageIndex={pageIndex}
						active={pageTranslateState.active}
						running={pageTranslateState.running}
						onToggle={handlers.onTogglePageLayoutTranslate}
					/>
				) : null}
				<CitationLinkLayer
					links={marks.citationLinks.get(pageIndex) ?? EMPTY_CITATION_LINKS}
					textLinks={marks.textLinks.get(pageIndex) ?? []}
					pageWidthPt={width / zoomRef.current}
					pageHeightPt={height / zoomRef.current}
					label={t("pdf.linkAria")}
					onActivate={handlers.onCitationActivate}
					onTextActivate={handlers.onTextLinkActivate}
					onHover={handlers.onCitationHover}
				/>
				<PdfRegionSelectLayer
					active={mode.regionSelecting && !mode.visualCropPending}
					label={t("pdfExplain.regionSelectionLabel", {
						page: pageNumber,
					})}
					onSelect={(region) => handlers.onRegionSelect(pageNumber, region)}
				/>
				{/*
				 * Debug Eye overlay: pre-merge detections (all kinds, no NMS),
				 * score ≥ LAYOUT_SIDEBAR_MIN_SCORE (30%). Label = kind + conf.
				 */}
				{layout.layoutOverlayVisible
					? layout.rawRegionsByPage.get(pageIndex)?.map((region) => {
							const pct = Math.round(region.score * 100);
							const kindLabel = t(layoutKindI18nKey(region.kind));
							const label = t("figures.overlayLabel", {
								kind: kindLabel,
								pct,
							});
							return (
								<div
									key={`layout-box-${region.id}`}
									className={cn(
										"pointer-events-none absolute z-[1] rounded-none border",
									)}
									style={{
										left: `${region.bbox.x * 100}%`,
										top: `${region.bbox.y * 100}%`,
										width: `${region.bbox.w * 100}%`,
										height: `${region.bbox.h * 100}%`,
										borderColor: layoutKindBorder(region.kind),
										backgroundColor: layoutKindFill(region.kind),
									}}
									aria-hidden="true"
								>
									<span
										className="absolute top-0 left-0 max-w-full truncate rounded-br-sm px-1 py-px font-medium text-caption text-white leading-4"
										style={{
											backgroundColor: layoutKindHex(region.kind),
										}}
									>
										{label}
									</span>
								</div>
							);
						})
					: null}
				{/* Bulk layout translate: progressive text overlays over body blocks. */}
				{translateOverlay}
				{/*
				 * Hit targets for post-merge figure/table/algorithm/formula.
				 * Largest first so smaller boxes stack on top and win pointer hits.
				 * Hidden when framing or a visual draft is open (not during crop:
				 * unmount leave must not cancel an in-flight crop).
				 * All kinds crop on click; hover and keyboard focus preview the
				 * exact bbox that would be cropped.
				 */}
				{!mode.regionSelecting && !mode.visualDraftOpen && !mode.plainViewer
					? layout.hoverableRegionsByPage.get(pageIndex)?.map((region) => {
							// Fixed-size chip in a zoom-scaled box: only draw it where
							// it actually fits inside the region.
							const showHint =
								region.bbox.w * width >= LAYOUT_HINT_MIN_REGION_W_PX &&
								region.bbox.h * height >= LAYOUT_HINT_MIN_REGION_H_PX;
							return (
								<button
									key={`layout-hit-${region.id}`}
									type="button"
									data-layout-hit={region.id}
									aria-label={t("figures.clickAnnotateAria", {
										kind: t(layoutKindI18nKey(region.kind)),
									})}
									// Click crops in place; pointer cursor is reserved for
									// navigation (citation links).
									className={cn(
										"group absolute z-[2] cursor-crosshair rounded-none border-0 bg-transparent p-0 transition-colors hover:bg-default-primary/5",
									)}
									style={{
										left: `${region.bbox.x * 100}%`,
										top: `${region.bbox.y * 100}%`,
										width: `${region.bbox.w * 100}%`,
										height: `${region.bbox.h * 100}%`,
									}}
									onPointerDown={(event) => {
										pointerOriginRef.current = {
											x: event.clientX,
											y: event.clientY,
										};
									}}
									onClick={(event) => {
										const origin = pointerOriginRef.current;
										pointerOriginRef.current = null;
										// A drag that merely started here is not a click.
										if (
											!isLayoutRegionActivation({
												detail: event.detail,
												origin,
												end: { x: event.clientX, y: event.clientY },
											})
										) {
											return;
										}
										event.preventDefault();
										event.stopPropagation();
										handlers.onLayoutRegionClick(region);
									}}
								>
									{/*
									 * Frame the exact crop bounds before the click commits, and
									 * give keyboard focus a visible landmark over unpredictable
									 * page content.
									 */}
									<span
										className={cn(
											PDF_VISUAL_REGION_FRAME_CLASS,
											"inset-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100",
										)}
										aria-hidden="true"
									/>
									{showHint ? (
										<span
											className="pointer-events-none absolute top-1 right-1 max-w-[calc(100%-0.5rem)] truncate rounded border border-border/60 bg-background/90 px-1.5 py-0.5 font-medium text-caption text-foreground/90 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
											aria-hidden="true"
										>
											{t("figures.clickAnnotateHint")}
										</span>
									) : null}
								</button>
							);
						})
					: null}
				{/* Open ask conversation card: highlight the anchored selection. */}
				{activeAskOnPage
					? activeAskOnPage.rects.map((rect) => (
							<div
								key={`${activeAskOnPage.id}-source-${rect.x}-${rect.y}-${rect.w}-${rect.h}`}
								className={cn(
									"pointer-events-auto absolute z-[1] rounded-[2px] bg-amber-300/45 dark:bg-amber-400/35",
								)}
								style={{
									left: `${rect.x * 100}%`,
									top: `${rect.y * 100}%`,
									width: `${rect.w * 100}%`,
									height: `${rect.h * 100}%`,
								}}
								aria-hidden="true"
								onMouseEnter={handlers.onCardHoverEnter}
								onMouseLeave={handlers.onCardHoverLeave}
							/>
						))
					: null}
				{activeTranslateOnPage
					? activeTranslateOnPage.rects.map((rect) => (
							<div
								key={`${activeTranslateOnPage.id}-source-${rect.x}-${rect.y}-${rect.w}-${rect.h}`}
								className={cn(
									"pointer-events-auto absolute z-[1] rounded-[2px] bg-yellow-300/40 dark:bg-yellow-400/35",
								)}
								style={{
									left: `${rect.x * 100}%`,
									top: `${rect.y * 100}%`,
									width: `${rect.w * 100}%`,
									height: `${rect.h * 100}%`,
								}}
								aria-hidden="true"
								onMouseEnter={handlers.onCardHoverEnter}
								onMouseLeave={handlers.onCardHoverLeave}
							/>
						))
					: null}
				{/* Open visual draft / mark: show the framed source region on-page. */}
				{visualDraftRegionOnPage ? (
					<div
						className={cn(PDF_VISUAL_REGION_FRAME_CLASS, "z-[2]")}
						style={{
							left: `${visualDraftRegionOnPage.x * 100}%`,
							top: `${visualDraftRegionOnPage.y * 100}%`,
							width: `${visualDraftRegionOnPage.w * 100}%`,
							height: `${visualDraftRegionOnPage.h * 100}%`,
						}}
						aria-hidden="true"
					/>
				) : null}
				{/*
				 * Crop in flight: PDFium renders the region asynchronously, so frame
				 * it and spin — otherwise a click looks like nothing happened.
				 */}
				{visualCropRegionOnPage ? (
					<div
						className={cn(
							PDF_VISUAL_REGION_FRAME_CLASS,
							"z-[3] flex items-center justify-center",
						)}
						style={{
							left: `${visualCropRegionOnPage.x * 100}%`,
							top: `${visualCropRegionOnPage.y * 100}%`,
							width: `${visualCropRegionOnPage.w * 100}%`,
							height: `${visualCropRegionOnPage.h * 100}%`,
						}}
						role="status"
						aria-label={t("pdfExplain.cropping")}
					>
						<Loader2
							className="size-4 animate-spin text-default-primary"
							aria-hidden="true"
						/>
					</div>
				) : null}
				{/* Figures selection outline, or citation yellow flash block. */}
				{focusedLayoutOnPage ? (
					<div
						key={`${focusedLayoutOnPage.id}:${focusedLayoutOnPage.pageIndex}:${focusedLayoutOnPage.bbox.y}:${marks.focusedLayoutFlashToken}`}
						className={cn(
							"pointer-events-none absolute rounded-sm border",
							marks.focusedLayoutFlash
								? "citation-focus-flash z-[6] border-amber-400/90 bg-amber-300/55 shadow-[0_0_0_1px_rgba(251,191,36,0.55)] dark:bg-amber-300/40"
								: "z-[2] shadow-[0_0_0_1px_rgba(255,255,255,0.55)] dark:shadow-[0_0_0_1px_rgba(0,0,0,0.5)]",
						)}
						style={
							marks.focusedLayoutFlash
								? {
										left: `${focusedLayoutOnPage.bbox.x * 100}%`,
										top: `${focusedLayoutOnPage.bbox.y * 100}%`,
										width: `${focusedLayoutOnPage.bbox.w * 100}%`,
										height: `${focusedLayoutOnPage.bbox.h * 100}%`,
									}
								: {
										left: `${focusedLayoutOnPage.bbox.x * 100}%`,
										top: `${focusedLayoutOnPage.bbox.y * 100}%`,
										width: `${focusedLayoutOnPage.bbox.w * 100}%`,
										height: `${focusedLayoutOnPage.bbox.h * 100}%`,
										borderColor: layoutKindHex(focusedLayoutOnPage.kind),
										backgroundColor: layoutKindFill(focusedLayoutOnPage.kind),
										outline: `1px solid ${layoutKindBorder(focusedLayoutOnPage.kind)}`,
									}
						}
						aria-hidden="true"
					/>
				) : null}
				{/* Active visual mark: default-theme outline of the crop region. */}
				{activeVisualOnPage
					? activeVisualOnPage.rects.map((rect) => (
							<div
								key={`${activeVisualOnPage.id}-region-${rect.x}-${rect.y}-${rect.w}-${rect.h}`}
								className={cn(PDF_VISUAL_REGION_FRAME_CLASS, "z-[2]")}
								style={{
									left: `${rect.x * 100}%`,
									top: `${rect.y * 100}%`,
									width: `${rect.w * 100}%`,
									height: `${rect.h * 100}%`,
								}}
								aria-hidden="true"
							/>
						))
					: null}
				{!mode.plainViewer ? (
					<SelectionGutter
						items={pins}
						activeId={marks.activeCardId}
						onOpen={handlers.onOpenPin}
						onEnter={handlers.onCardHoverEnter}
						onLeave={handlers.onCardHoverLeave}
					/>
				) : null}
				{/*
				 * Emphasis overlay for the hovered or edited comment-rail card.
				 * Visual notes reuse the shared region frame so the rail card,
				 * the marquee draft and the click-crop all read as one UI; skip
				 * it while the open trace already frames the same rects below.
				 */}
				{emphasizedComment &&
				!(emphasizedComment.kind === "visual" && activeVisualOnPage)
					? emphasizedComment.rects.map((rect) => (
							<div
								key={`comment-hover-${emphasizedComment.id}-${rect.x}-${rect.y}-${rect.w}-${rect.h}`}
								className={cn(
									"pointer-events-none absolute z-[4]",
									emphasizedComment.kind === "visual"
										? PDF_VISUAL_REGION_FRAME_CLASS
										: "rounded-[1px] mix-blend-multiply",
								)}
								style={{
									left: `${rect.x * 100}%`,
									top: `${rect.y * 100}%`,
									width: `${rect.w * 100}%`,
									height: `${rect.h * 100}%`,
									backgroundColor:
										emphasizedComment.kind === "visual"
											? undefined
											: highlightHoverOverlayColor(emphasizedComment.color),
								}}
								aria-hidden="true"
							/>
						))
					: null}
				{/*
				 * Bidirectional hover for rail comments: hovering the page region
				 * (text highlight or visual crop) emphasizes the card and draws the
				 * connector. Visual regions keep the existing click-to-edit path (#396);
				 * text highlights with a note do the same, while plain highlights
				 * (not in `comments`) still use EmbedPDF's annotation menu.
				 */}
				{comments.map((comment) =>
					comment.rects.map((rect) =>
						comment.kind === "visual" ? (
							<button
								key={`comment-hover-hit-${comment.id}-${rect.x}-${rect.y}-${rect.w}-${rect.h}`}
								type="button"
								className={cn("absolute z-[3] cursor-pointer bg-transparent")}
								style={{
									left: `${rect.x * 100}%`,
									top: `${rect.y * 100}%`,
									width: `${rect.w * 100}%`,
									height: `${rect.h * 100}%`,
								}}
								aria-label={t("pdfExplain.visualAnnotation")}
								onMouseEnter={() => handlers.onHoverComment(comment)}
								onMouseLeave={handlers.onLeaveComment}
								onClick={(event) => {
									event.stopPropagation();
									handlers.onOpenComment(comment);
								}}
							/>
						) : null,
					),
				)}
				{!mode.plainViewer ? (
					<CommentCardsLayer
						items={comments}
						pageWidthPx={width}
						pageHeightPx={height}
						editingId={marks.editingCommentId}
						wikiTarget={marks.commentWikiTarget}
						hoveredId={marks.hoveredCommentId}
						selectionDraft={selectionDraftOnPage}
						onCommitSelectionComment={handlers.onCommitSelectionComment}
						onSelectionCommentActiveChange={
							handlers.onSelectionCommentActiveChange
						}
						onDismissSelectionComment={handlers.onDismissSelectionComment}
						onOpen={handlers.onOpenComment}
						onSave={handlers.onSaveComment}
						onCancel={handlers.onCancelComment}
						onDelete={handlers.onDeleteComment}
						onCopyLink={handlers.onCopyCommentLink}
						onCopyEmbed={handlers.onCopyCommentEmbed}
						onAddToChat={handlers.onAddCommentToChat}
						onHover={handlers.onHoverComment}
						onLeave={handlers.onLeaveComment}
					/>
				) : null}
			</PagePointerProvider>
		</div>
	);
});
