/**
 * Coalesce deferred viewport scroll requests. The viewport owner cancels a
 * request only after an explicit user-input precursor; native scroll events
 * themselves can also come from layout, zoom, or pane synchronization.
 *
 * EmbedPDF emits scroll requests synchronously, while the DOM viewport is
 * updated on the next frame. On Windows/WebView2 a user wheel event can land
 * in that gap; applying the old request afterwards makes the PDF jump to the
 * beginning or end of the document.
 */

export type PdfViewportScrollRequest = {
	x: number;
	y: number;
	behavior?: ScrollBehavior;
};

export type PdfViewportScrollScheduler = {
	schedule: (request: PdfViewportScrollRequest) => void;
	cancelPending: () => void;
	dispose: () => void;
};

export function createPdfViewportScrollScheduler({
	apply,
	requestFrame = (callback) => requestAnimationFrame(callback),
	cancelFrame = (handle) => cancelAnimationFrame(handle),
}: {
	apply: (request: PdfViewportScrollRequest) => void;
	requestFrame?: (callback: FrameRequestCallback) => number;
	cancelFrame?: (handle: number) => void;
}): PdfViewportScrollScheduler {
	let pending: PdfViewportScrollRequest | null = null;
	let frame: number | null = null;
	let disposed = false;

	const cancelPending = () => {
		pending = null;
		if (frame === null) return;
		cancelFrame(frame);
		frame = null;
	};

	return {
		schedule(request) {
			if (disposed) return;
			pending = request;
			if (frame !== null) return;
			frame = requestFrame(() => {
				frame = null;
				const next = pending;
				pending = null;
				if (!disposed && next) apply(next);
			});
		},
		cancelPending,
		dispose() {
			if (disposed) return;
			disposed = true;
			cancelPending();
		},
	};
}
