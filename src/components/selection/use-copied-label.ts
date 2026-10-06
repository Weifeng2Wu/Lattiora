/**
 * Transient "copied" confirmation label shared by the auto-copy selection
 * surfaces (PDF viewer, plaza feed, proxied web papers): after each auto-copy
 * the label shows at a screen point for COPIED_LABEL_DURATION_MS, then hides.
 */

import { useCallback, useRef, useState } from "react";

const COPIED_LABEL_DURATION_MS = 1000;

export type CopiedLabelApi = {
	/** Screen anchor of the visible label (null when hidden). */
	copiedLabelPos: { x: number; y: number } | null;
	/**
	 * (Re)start the label at `pos`; a null pos only clears it (surfaces that
	 * anchor on the last mouse-up pass it straight through).
	 */
	showCopiedLabel: (pos: { x: number; y: number } | null) => void;
	/** Hide immediately and drop the pending timer. */
	clearCopiedLabel: () => void;
};

export function useCopiedLabel(): CopiedLabelApi {
	const [copiedLabelPos, setCopiedLabelPos] = useState<{
		x: number;
		y: number;
	} | null>(null);
	const labelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const clearCopiedLabel = useCallback(() => {
		if (labelTimerRef.current) {
			clearTimeout(labelTimerRef.current);
			labelTimerRef.current = null;
		}
		setCopiedLabelPos(null);
	}, []);

	const showCopiedLabel = useCallback(
		(pos: { x: number; y: number } | null) => {
			clearCopiedLabel();
			if (!pos) return;
			setCopiedLabelPos(pos);
			labelTimerRef.current = setTimeout(() => {
				labelTimerRef.current = null;
				setCopiedLabelPos(null);
			}, COPIED_LABEL_DURATION_MS);
		},
		[clearCopiedLabel],
	);

	return { copiedLabelPos, showCopiedLabel, clearCopiedLabel };
}
