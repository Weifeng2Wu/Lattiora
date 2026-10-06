/**
 * Screen-anchor helper for region crops.
 *
 * The floating visual-annotation draft card has been removed (#396); this hook
 * now only provides `screenPointForRegion` so the crop completion callback can
 * compute the old card anchor (kept for any future overlay use).
 */

import { type RefObject, useCallback } from "react";
import { pageElByIndex } from "@/components/viewer/pdf/coords";
import type { ScreenPoint } from "@/components/viewer/pdf/types";
import type { PdfAskNormalizedRect } from "@/lib/pdf/ask/types";

export type UsePdfVisualDraftOptions = {
	hostRef: RefObject<HTMLDivElement | null>;
};

export type PdfVisualDraft = {
	/** Screen anchor beside a page-normalized region (legacy card placement). */
	screenPointForRegion: (
		pageIndex0: number,
		region: PdfAskNormalizedRect,
	) => ScreenPoint;
};

export function usePdfVisualDraft({
	hostRef,
}: UsePdfVisualDraftOptions): PdfVisualDraft {
	/** Screen point near a layout bbox (right edge) for the draft card. */
	const screenPointForRegion = useCallback(
		(pageIndex0: number, region: PdfAskNormalizedRect) => {
			const pageEl = pageElByIndex(hostRef.current, pageIndex0);
			if (!pageEl) return { x: 120, y: 120 };
			const box = pageEl.getBoundingClientRect();
			return {
				x: box.left + (region.x + region.w) * box.width + 8,
				y: box.top + region.y * box.height,
			};
		},
		[hostRef],
	);

	return { screenPointForRegion };
}
