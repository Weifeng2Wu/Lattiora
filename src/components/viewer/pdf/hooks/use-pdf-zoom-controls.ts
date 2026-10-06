/**
 * Mirror the live zoom level into a ref for render paths that must not
 * re-subscribe on every zoom change (page layers, selection placement, etc.).
 */

import { type RefObject, useRef } from "react";

export type PdfZoomControls = {
	/** Latest observed zoom, for render paths that must not re-run on change. */
	zoomRef: RefObject<number>;
};

export function usePdfZoomControls(zoomLevel: number): PdfZoomControls {
	const zoomRef = useRef(zoomLevel);
	zoomRef.current = zoomLevel;
	return { zoomRef };
}
