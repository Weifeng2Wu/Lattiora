import {
	dataTransferLooksLikeOsFiles,
	dataTransferLooksLikePdfs,
	dataTransferLooksLikeVaultMove,
} from "@/lib/core/file-accept";
import type { ResolvedDropPdf } from "@/lib/shell/external-file-drop";
import {
	resolveDroppedPdfPaths,
	snapshotDataTransfer,
} from "@/lib/shell/external-file-drop";

export type ExternalPdfDropOptions = {
	onImport: (items: ResolvedDropPdf[]) => void;
	onError?: (error: unknown) => void;
};

/**
 * Route an unclaimed browser drop of one or more external PDFs.
 *
 * Target-specific handlers (Library / papers tree) stop propagation after
 * choosing their destination. This function is the window-level fallback for
 * surfaces such as the PDF reader, notes editor, and empty workspace.
 */
export function handleExternalPdfDrop(
	event: DragEvent,
	options: ExternalPdfDropOptions,
): boolean {
	const dataTransfer = event.dataTransfer;
	if (
		dataTransferLooksLikeVaultMove(dataTransfer) ||
		!dataTransferLooksLikeOsFiles(dataTransfer) ||
		!dataTransferLooksLikePdfs(dataTransfer)
	) {
		return false;
	}

	event.preventDefault();
	try {
		// Snapshot before returning to the event loop: WKWebView can revoke the
		// FileList as soon as the native drop handler finishes.
		const snapshot = snapshotDataTransfer(dataTransfer);
		void resolveDroppedPdfPaths(snapshot)
			.then(options.onImport)
			.catch((error) => options.onError?.(error));
	} catch (error) {
		options.onError?.(error);
	}
	return true;
}
