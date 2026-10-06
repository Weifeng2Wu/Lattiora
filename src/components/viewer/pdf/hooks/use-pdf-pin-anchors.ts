/**
 * Pin-anchor projections of the ask threads.
 *
 * The viewer's marks arrays are replaced wholesale on every stream chunk, but
 * gutter pins only depend on anchor geometry — these projections isolate that
 * geometry with a stable identity (see {@link useStableDerived}) so
 * `buildMarksIndex` (and with it every mounted page) skips re-deriving while an
 * answer streams.
 */

import { useStableDerived } from "@/components/viewer/pdf/hooks/use-stable-derived";
import { threadHasUserQuestion, threadPreview } from "@/lib/pdf/ask/schema";
import type { PdfAskNormalizedRect, PdfAskThread } from "@/lib/pdf/ask/types";

/**
 * Geometry-only projection of a mark for gutter pins. Extracted from the ask
 * array with a stable identity (see {@link useStableDerived}) so the per-chunk
 * streaming message bodies cannot invalidate `pinsByPage` (and with it every
 * mounted page).
 */
export type AskPinAnchor = {
	id: string;
	/** 1-based page number */
	page: number;
	rects: PdfAskNormalizedRect[];
	preview: string;
	ended: boolean;
};

/** Compact value fingerprint of normalized rects (pin geometry input). */
function rectsKey(
	rects: ReadonlyArray<{ x: number; y: number; w: number; h: number }>,
): string {
	return rects.map((r) => `${r.x},${r.y},${r.w},${r.h}`).join("~");
}

export type UsePdfPinAnchorsOptions = {
	threads: PdfAskThread[];
};

export type PdfPinAnchors = {
	askPinAnchors: AskPinAnchor[];
};

export function usePdfPinAnchors({
	threads,
}: UsePdfPinAnchorsOptions): PdfPinAnchors {
	/**
	 * Pin geometry is anchor data only. While an answer streams, every chunk
	 * replaces the whole threads array, but none of the fields fingerprinted
	 * below change — so these projections keep their identity and `pinsByPage`
	 * (and thus every mounted page) skips re-rendering per chunk.
	 */
	const askPinAnchors = useStableDerived<AskPinAnchor[]>(
		() =>
			threads.filter(threadHasUserQuestion).map((th) => ({
				id: th.id,
				page: th.anchor.page,
				rects: th.anchor.rects,
				preview: threadPreview(th),
				ended: th.status === "ended",
			})),
		threads
			.map(
				(th) =>
					`${th.id}|${threadHasUserQuestion(th) ? 1 : 0}|${th.anchor.page}|${th.status}|${threadPreview(th)}|${rectsKey(th.anchor.rects)}`,
			)
			.join(";"),
	);
	return { askPinAnchors };
}
