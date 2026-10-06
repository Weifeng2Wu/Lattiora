import type { PdfHighlightAnnoObject, Rect, Size } from "@embedpdf/models";
import { PdfAnnotationSubtype } from "@embedpdf/models";
import type { AnnotationTransferItem } from "@embedpdf/plugin-annotation/react";

import { listPdfHighlights } from "@/lib/pdf/highlight/io";
import {
	HIGHLIGHT_HEX,
	HIGHLIGHT_OPACITY,
	normalizeHighlightColor,
} from "@/lib/pdf/highlight/palette";
import { deleteMarkFile } from "@/lib/pdf/selection/marks-io";

function unionRect(rects: Rect[]): Rect | null {
	if (!rects.length) return null;
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const r of rects) {
		minX = Math.min(minX, r.origin.x);
		minY = Math.min(minY, r.origin.y);
		maxX = Math.max(maxX, r.origin.x + r.size.width);
		maxY = Math.max(maxY, r.origin.y + r.size.height);
	}
	return {
		origin: { x: minX, y: minY },
		size: { width: maxX - minX, height: maxY - minY },
	};
}

/**
 * One-time migration of legacy normalized-rect highlight marks
 * (`papers/<id>/marks/<id>.json`, kind "highlight") into EmbedPDF annotation
 * transfer items (later saved as `marks/annotations.json`). Normalized rects
 * (top-left origin, y-down) are scaled by the page size in points.
 * Ask/Translate marks are left untouched.
 *
 * Migrated highlight mark files are deleted so `marks/annotations.json` becomes
 * the single source of truth for highlights/批注.
 */
export async function migrateHighlightMarks(
	paperAbsPath: string,
	pageSizePoints: (pageIndex: number) => Size | null,
): Promise<AnnotationTransferItem[]> {
	const olds = await listPdfHighlights(paperAbsPath);
	if (!olds.length) return [];

	const items: AnnotationTransferItem[] = [];
	const migratedIds: string[] = [];

	for (const h of olds) {
		const pageIndex = Math.max(0, Math.floor(h.page) - 1);
		const size = pageSizePoints(pageIndex);
		if (!size) continue;
		const segmentRects: Rect[] = h.rects.map((r) => ({
			origin: { x: r.x * size.width, y: r.y * size.height },
			size: { width: r.w * size.width, height: r.h * size.height },
		}));
		const color = normalizeHighlightColor(h.color);
		const obj: PdfHighlightAnnoObject = {
			type: PdfAnnotationSubtype.HIGHLIGHT,
			id: h.id,
			pageIndex,
			rect: unionRect(segmentRects) ?? { origin: { x: 0, y: 0 }, size },
			segmentRects,
			strokeColor: HIGHLIGHT_HEX[color],
			opacity: HIGHLIGHT_OPACITY,
			created: new Date(h.createdAt),
			custom: { app: "agentero", paletteKey: color, quote: h.quote },
		};
		if (h.comment?.trim()) obj.contents = h.comment.trim();
		items.push({ annotation: obj });
		migratedIds.push(h.id);
	}

	for (const id of migratedIds) {
		try {
			await deleteMarkFile(paperAbsPath, id);
		} catch {
			// leaving a stale mark is harmless; ignore
		}
	}

	return items;
}
