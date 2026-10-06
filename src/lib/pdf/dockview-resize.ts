export type PdfViewportResizeGate = {
	notifyResize: () => void;
	beginDockResize: () => void;
	endDockResize: () => void;
	dispose: () => void;
};

/**
 * Coalesce ordinary ResizeObserver callbacks to animation frames, suppress
 * them while a Dockview sash is active, then commit the final geometry once.
 */
export function createPdfViewportResizeGate({
	commitResize,
	requestFrame = (callback) => requestAnimationFrame(callback),
	cancelFrame = (handle) => cancelAnimationFrame(handle),
}: {
	commitResize: () => void;
	requestFrame?: (callback: FrameRequestCallback) => number;
	cancelFrame?: (handle: number) => void;
}): PdfViewportResizeGate {
	let dockResizeActive = false;
	let disposed = false;
	let pendingFrame: number | null = null;

	const cancelPending = () => {
		if (pendingFrame === null) return;
		cancelFrame(pendingFrame);
		pendingFrame = null;
	};
	const scheduleCommit = () => {
		if (disposed || dockResizeActive || pendingFrame !== null) return;
		pendingFrame = requestFrame(() => {
			pendingFrame = null;
			if (!disposed && !dockResizeActive) commitResize();
		});
	};

	return {
		notifyResize: scheduleCommit,
		beginDockResize() {
			if (disposed || dockResizeActive) return;
			dockResizeActive = true;
			cancelPending();
		},
		endDockResize() {
			if (disposed || !dockResizeActive) return;
			dockResizeActive = false;
			scheduleCommit();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			cancelPending();
		},
	};
}
