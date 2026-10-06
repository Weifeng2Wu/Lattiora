/**
 * PDF drop highlight + import for the Library table.
 *
 * Overlay machinery (macOS-safe document dragover hit-testing + Tauri
 * `onDragDropEvent` state machine) lives in `useFileDragOverlay`; this hook
 * owns the PDF predicates and the import flow. Overlay only when the payload
 * is a PDF (one or more); images / other types stay ignored. Drops are
 * accepted only when the pointer is over the Library panel so file-tree
 * `papers/` imports are not stolen.
 */
import type { DragEvent as ReactDragEvent } from "react";
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useFileDragOverlay } from "@/hooks/use-file-drag-overlay";
import {
	dataTransferLooksLikeOsFiles,
	dataTransferLooksLikePdfs,
	dataTransferLooksLikeVaultMove,
	hasPdfExtension,
	isPdfMimeOrUti,
} from "@/lib/core/file-accept";
import { notifyError } from "@/lib/core/notify";
import { isVaultFileDragActive } from "@/lib/core/vault-file-drag";
import { libraryDropParentDir } from "@/lib/paper/api";
import { dropLocalPdfs } from "@/lib/paper/import-actions";
import { currentLookupParentDir } from "@/lib/paper/library-actions";
import {
	pdfsFromPaths,
	type ResolvedDropPdf,
	resolveDroppedPdfPaths,
	snapshotDataTransfer,
} from "@/lib/shell/external-file-drop";

function snapshotLooksLikePdf(
	snap: ReturnType<typeof snapshotDataTransfer>,
): boolean {
	if (snap.paths.some((path) => hasPdfExtension(path))) return true;
	return snap.files.some(
		(file) =>
			isPdfMimeOrUti(file.type) ||
			hasPdfExtension(file.name) ||
			(file.path != null && hasPdfExtension(file.path)),
	);
}

function destForLibraryDrop(scopePath: string | null | undefined): string {
	return libraryDropParentDir(scopePath, currentLookupParentDir());
}

export function useLibraryPdfDrop(scopePath: string | null | undefined) {
	const { t } = useTranslation("sidebar");
	const scopePathRef = useRef(scopePath);
	scopePathRef.current = scopePath;

	const importPdfs = useCallback((items: ResolvedDropPdf[]) => {
		if (!items.length) return;
		dropLocalPdfs(items, destForLibraryDrop(scopePathRef.current));
	}, []);

	const {
		shellRef,
		isDragOver,
		resetDragOver,
		onDragEnter,
		onDragLeave,
		onDragOver,
	} = useFileDragOverlay({
		looksLikeDrag: dataTransferLooksLikePdfs,
		pathsMatch: (paths) => pdfsFromPaths(paths).length > 0,
		onTauriDrop: (paths) => {
			const pdfs = pdfsFromPaths(paths);
			if (!pdfs.length) return false;
			importPdfs(pdfs);
			return true;
		},
	});

	const onPdfDrop = useCallback(
		(event: ReactDragEvent) => {
			const dt =
				(event.nativeEvent as DragEvent | undefined)?.dataTransfer ??
				event.dataTransfer;
			if (dataTransferLooksLikeVaultMove(dt) || isVaultFileDragActive()) {
				return;
			}
			if (!dataTransferLooksLikeOsFiles(dt) && !dataTransferLooksLikePdfs(dt)) {
				return;
			}
			const snap = snapshotDataTransfer(dt);
			if (!snapshotLooksLikePdf(snap)) return;
			event.preventDefault();
			event.stopPropagation();
			resetDragOver();
			void resolveDroppedPdfPaths(snap)
				.then((pdfs) => {
					importPdfs(pdfs);
				})
				.catch((error) => {
					notifyError(
						error instanceof Error
							? error.message
							: t("importLocalPdf.dropNoPath"),
					);
				});
		},
		[importPdfs, resetDragOver, t],
	);

	return {
		shellRef,
		isPdfDragOver: isDragOver,
		onPdfDragEnter: onDragEnter,
		onPdfDragLeave: onDragLeave,
		onPdfDragOver: onDragOver,
		onPdfDrop,
	};
}
