/**
 * Highlights (划词高亮/批注) for the EmbedPDF viewer. Highlights are *not* an
 * app-side overlay: they are real PDF annotations owned by EmbedPDF's annotation
 * plugin and persisted to `marks/annotations.json`, so this cluster is the whole
 * bridge between that plugin scope and the React tree.
 *
 * It owns three derived states that share exactly one writer — `rebuildHighlights`,
 * which runs once per coalesced annotation-event burst (a batch import emits
 * one event per annotation):
 * - `highlights`: the view models published to the annotations panel;
 * - `highlightAnchors`: normalized 0–1 rects for gutter-pin placement, computed
 *   here (where the raw objects and page sizes are already in hand) so pin
 *   geometry never reads plugin state during render;
 * - `citationLinks`: the per-page link map, a by-product of the same walk over
 *   the tracked annotation list (consumed by {@link usePdfCitations}).
 *
 * Its own hook because plugin ownership is the boundary: import/migrate-on-open,
 * the event subscription and the debounced export are one lifecycle, while every
 * reader (page layers, pins, annotations panel, imperative handle) only needs the
 * resulting arrays.
 */

import type {
	PdfHighlightAnnoObject,
	PdfLinkAnnoObject,
} from "@embedpdf/models";
import { PdfAnnotationSubtype } from "@embedpdf/models";
import type {
	AnnotationTransferItem,
	useAnnotationCapability,
} from "@embedpdf/plugin-annotation/react";
import type { useDocumentManagerCapability } from "@embedpdf/plugin-document-manager/react";
import type { FormattedSelection } from "@embedpdf/plugin-selection/react";
import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { isLinkObject } from "@/components/viewer/pdf/layers/citation-links";
import type { PdfViewerProps } from "@/components/viewer/pdf/types";
import {
	ANNOTATIONS_FILE,
	type HighlightCustom,
	hasAnnotationsFile,
	highlightViewFromObject,
	isHighlightObject,
	loadAnnotationItems,
	saveAnnotationItems,
} from "@/lib/pdf/highlight/annotation-store";
import { migrateHighlightMarks } from "@/lib/pdf/highlight/migrate-marks";
import {
	HIGHLIGHT_HEX,
	HIGHLIGHT_OPACITY,
	type HighlightColor,
} from "@/lib/pdf/highlight/palette";
import type { PdfHighlight } from "@/lib/pdf/highlight/types";
import type { NormalizedRect } from "@/lib/pdf/selection";
import { marksDir } from "@/lib/pdf/selection";
import { isRecentSelfWrite } from "@/lib/pdf/selection/marks-io";
import { listenVaultFileChangedGated } from "@/lib/vault/file-change-gate";
import { joinVaultPath, normalizePathKey } from "@/lib/vault/path";

/** Coalesce annotation bursts (drag-create, multi-page highlight) into one export. */
const HIGHLIGHT_SAVE_DEBOUNCE_MS = 600;

/** One CLI invocation can append several highlights; coalesce the watcher burst. */
const ANNOTATIONS_REIMPORT_BURST_MS = 200;

type AnnotationCapabilityProvides = ReturnType<
	typeof useAnnotationCapability
>["provides"];

type DocumentManagerCapability = ReturnType<
	typeof useDocumentManagerCapability
>["provides"];

export type UsePdfHighlightsOptions = {
	/** EmbedPDF capability; owned by `PdfViewerInner` (plugin context). */
	annotationCap: AnnotationCapabilityProvides;
	/** EmbedPDF capability; returns a fresh scope each render, so never a dep. */
	docCap: DocumentManagerCapability;
	docId: string;
	/** Sidecar location for `marks/annotations.json` (null for loose PDFs). */
	paperAbsPath: string | null;
	/** Stable paper key stamped onto the published highlight view models. */
	paperKey: string | null;
	/** Import waits for the document, which is what makes the page count > 0. */
	totalPages: number;
	/** Prop-latest ref so publishing never re-fires on parent re-render. */
	onHighlightsChangeRef: RefObject<PdfViewerProps["onHighlightsChange"]>;
};

export type PdfHighlights = {
	highlights: PdfHighlight[];
	/** Mirror for the imperative handle (must not re-register per change). */
	highlightsRef: RefObject<PdfHighlight[]>;
	/** Annotation id → normalized rect, for gutter-pin placement. */
	highlightAnchors: Map<string, NormalizedRect>;
	/** 0-based page index → in-text link annotations with a target. */
	citationLinks: Map<number, PdfLinkAnnoObject[]>;
	/** Re-read the plugin scope; also the annotation-event handler. */
	rebuildHighlights: () => void;
	/** Create one highlight per selected page span; returns the new ids. */
	createHighlights: (
		pages: FormattedSelection[],
		color: HighlightColor,
		quote: string,
	) => { pageIndex: number; id: string }[];
	/** Write a 批注 comment onto an existing highlight (empty clears it). */
	updateHighlightComment: (
		pageIndex: number,
		id: string,
		comment: string,
	) => void;
	/** Change the color of an existing highlight annotation. */
	updateHighlightColor: (
		pageIndex: number,
		id: string,
		color: HighlightColor,
	) => void;
	deleteHighlightAnnotation: (pageIndex: number, id: string) => void;
};

export function usePdfHighlights({
	annotationCap,
	docCap,
	docId,
	paperAbsPath,
	paperKey,
	totalPages,
	onHighlightsChangeRef,
}: UsePdfHighlightsOptions): PdfHighlights {
	const [highlights, setHighlights] = useState<PdfHighlight[]>([]);
	/** Normalized annotation rects for pin placement, keyed by annotation id. */
	const [highlightAnchors, setHighlightAnchors] = useState(
		() => new Map<string, NormalizedRect>(),
	);
	const [citationLinks, setCitationLinks] = useState<
		Map<number, PdfLinkAnnoObject[]>
	>(new Map());
	const highlightsRef = useRef(highlights);
	highlightsRef.current = highlights;
	const importedRef = useRef(false);
	const importingRef = useRef(false);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const rebuildHighlights = useCallback(() => {
		if (!annotationCap) return;
		const scope = annotationCap.forDocument(docId);
		const all = scope.getAnnotations();
		const doc = docCap?.getDocument(docId);
		const objects = all.map((a) => a.object).filter(isHighlightObject);
		const list = objects.map((o) => {
			const view = highlightViewFromObject(o, paperKey ?? "");
			const size = doc?.pages[o.pageIndex]?.size;
			if (size?.width && size?.height) {
				const pw = size.width;
				const ph = size.height;
				const sourceRects = o.segmentRects?.length ? o.segmentRects : [o.rect];
				view.rects = sourceRects.map((r) => ({
					x: r.origin.x / pw,
					y: r.origin.y / ph,
					w: r.size.width / pw,
					h: r.size.height / ph,
				}));
			}
			return view;
		});
		setHighlights(list);
		onHighlightsChangeRef.current?.(list);
		// Pin anchors: normalize each annotation rect here, where the objects are
		// already in hand, so pin geometry never reads plugin state during render.
		const anchors = new Map<string, NormalizedRect>();
		for (const o of objects) {
			const size = doc?.pages[o.pageIndex]?.size;
			if (!size?.width || !size?.height) continue;
			anchors.set(o.id, {
				x: o.rect.origin.x / size.width,
				y: o.rect.origin.y / size.height,
				w: o.rect.size.width / size.width,
				h: o.rect.size.height / size.height,
			});
		}
		setHighlightAnchors(anchors);
		const links = new Map<number, PdfLinkAnnoObject[]>();
		for (const tracked of all) {
			const o = tracked.object;
			if (isLinkObject(o) && o.target) {
				const arr = links.get(o.pageIndex);
				if (arr) arr.push(o);
				else links.set(o.pageIndex, [o]);
			}
		}
		setCitationLinks(links);
	}, [annotationCap, docCap, docId, paperKey, onHighlightsChangeRef]);

	// A batch import emits one event per annotation within a single task;
	// coalesce the burst into one rebuild (n events → O(n²) full walks → O(n)).
	const rebuildPendingRef = useRef(false);
	const scheduleRebuild = useCallback(() => {
		if (rebuildPendingRef.current) return;
		rebuildPendingRef.current = true;
		queueMicrotask(() => {
			rebuildPendingRef.current = false;
			rebuildHighlights();
		});
	}, [rebuildHighlights]);

	const scheduleSave = useCallback(() => {
		if (!paperAbsPath || !annotationCap) return;
		if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		saveTimerRef.current = setTimeout(async () => {
			try {
				const items = await annotationCap
					.forDocument(docId)
					.exportAnnotations()
					.toPromise();
				await saveAnnotationItems(paperAbsPath, items);
			} catch {
				// transient export failures are non-fatal; next change retries
			}
		}, HIGHLIGHT_SAVE_DEBOUNCE_MS);
	}, [paperAbsPath, annotationCap, docId]);

	useEffect(() => {
		if (!annotationCap) return;
		const scope = annotationCap.forDocument(docId);
		const off = scope.onAnnotationEvent((event) => {
			scheduleRebuild();
			if (event.type !== "loaded" && !importingRef.current) scheduleSave();
		});
		rebuildHighlights();
		return () => off();
	}, [annotationCap, docId, rebuildHighlights, scheduleRebuild, scheduleSave]);

	useEffect(() => {
		if (importedRef.current || !annotationCap || !docCap || totalPages <= 0)
			return;
		importedRef.current = true;
		void (async () => {
			const scope = annotationCap.forDocument(docId);
			let items: AnnotationTransferItem[] = paperAbsPath
				? await loadAnnotationItems(paperAbsPath)
				: [];
			if (
				paperAbsPath &&
				!items.length &&
				!(await hasAnnotationsFile(paperAbsPath))
			) {
				const doc = docCap.getDocument(docId);
				const migrated = await migrateHighlightMarks(
					paperAbsPath,
					(pageIndex) => doc?.pages[pageIndex]?.size ?? null,
				);
				if (migrated.length) {
					items = migrated;
					await saveAnnotationItems(paperAbsPath, migrated);
				}
			}
			if (items.length) {
				importingRef.current = true;
				scope.importAnnotations(items);
				setTimeout(() => {
					importingRef.current = false;
					rebuildHighlights();
				}, 0);
			}
		})();
	}, [
		annotationCap,
		docCap,
		docId,
		totalPages,
		paperAbsPath,
		rebuildHighlights,
	]);

	// The CLI/Agent appends highlights straight into `marks/annotations.json`
	// (`agentero mark add --kind highlight`). The import above runs once per
	// mount, so without this an open viewer would neither show those highlights
	// nor keep them: its next debounced export would overwrite the file.
	useEffect(() => {
		if (!paperAbsPath || !annotationCap || totalPages <= 0) return;
		const target = normalizePathKey(
			joinVaultPath(marksDir(paperAbsPath), ANNOTATIONS_FILE),
		);
		let cancelled = false;
		let burstTimer: number | null = null;

		const schedule = () => {
			if (burstTimer !== null) return;
			burstTimer = window.setTimeout(() => {
				burstTimer = null;
				void reimport();
			}, ANNOTATIONS_REIMPORT_BURST_MS);
		};

		const reimport = async () => {
			// The mount-time import is still filling the scope; comparing against
			// it now would re-import the same ids. Wait one burst and retry.
			if (importingRef.current) {
				schedule();
				return;
			}
			const scope = annotationCap.forDocument(docId);
			const known = new Set(scope.getAnnotations().map((a) => a.object.id));
			const items = await loadAnnotationItems(paperAbsPath);
			if (cancelled) return;
			const fresh = items.filter(
				(i) => i.annotation?.id && !known.has(i.annotation.id),
			);
			if (!fresh.length) return;
			importingRef.current = true;
			scope.importAnnotations(fresh);
			setTimeout(() => {
				importingRef.current = false;
				rebuildHighlights();
			}, 0);
		};

		const unsub = listenVaultFileChangedGated((payload) => {
			const paths = [...payload.paths];
			if (payload.rename) {
				paths.push(payload.rename.from, payload.rename.to);
			}
			const hit = paths.filter((p) => normalizePathKey(p) === target);
			if (!hit.length) return;
			if (hit.every((p) => isRecentSelfWrite(p))) return;
			schedule();
		});
		return () => {
			cancelled = true;
			if (burstTimer !== null) window.clearTimeout(burstTimer);
			unsub();
		};
	}, [annotationCap, docId, paperAbsPath, totalPages, rebuildHighlights]);

	const createHighlights = useCallback(
		(pages: FormattedSelection[], color: HighlightColor, quote: string) => {
			const scope = annotationCap?.forDocument(docId);
			if (!scope) return [] as { pageIndex: number; id: string }[];
			const created: { pageIndex: number; id: string }[] = [];
			for (const page of pages) {
				const id = crypto.randomUUID();
				const obj: PdfHighlightAnnoObject = {
					type: PdfAnnotationSubtype.HIGHLIGHT,
					id,
					pageIndex: page.pageIndex,
					rect: page.rect,
					segmentRects: page.segmentRects,
					strokeColor: HIGHLIGHT_HEX[color],
					opacity: HIGHLIGHT_OPACITY,
					created: new Date(),
					custom: { app: "agentero", paletteKey: color, quote },
				};
				scope.createAnnotation(page.pageIndex, obj);
				created.push({ pageIndex: page.pageIndex, id });
			}
			return created;
		},
		[annotationCap, docId],
	);

	const updateHighlightComment = useCallback(
		(pageIndex: number, id: string, comment: string) => {
			annotationCap?.forDocument(docId).updateAnnotation(pageIndex, id, {
				contents: comment.trim() || undefined,
			});
		},
		[annotationCap, docId],
	);

	const updateHighlightColor = useCallback(
		(pageIndex: number, id: string, color: HighlightColor) => {
			const scope = annotationCap?.forDocument(docId);
			if (!scope) return;
			const obj = scope.getAnnotationById(id)?.object;
			if (!obj || !isHighlightObject(obj)) return;
			const custom = (obj.custom ?? {}) as HighlightCustom;
			scope.updateAnnotation(pageIndex, id, {
				strokeColor: HIGHLIGHT_HEX[color],
				custom: { ...custom, paletteKey: color },
			});
		},
		[annotationCap, docId],
	);

	const deleteHighlightAnnotation = useCallback(
		(pageIndex: number, id: string) => {
			annotationCap?.forDocument(docId).deleteAnnotation(pageIndex, id);
		},
		[annotationCap, docId],
	);

	return {
		highlights,
		highlightsRef,
		highlightAnchors,
		citationLinks,
		rebuildHighlights,
		createHighlights,
		updateHighlightComment,
		updateHighlightColor,
		deleteHighlightAnnotation,
	};
}
