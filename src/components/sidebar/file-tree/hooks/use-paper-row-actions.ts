/**
 * Busy state for the per-paper row actions (download assets / read paper) and
 * the Library-row "download all missing" action.
 */
import { useCallback, useMemo, useState } from "react";
import type { FileNode } from "@/lib/vault";
import { collectPapersNeedingAssets } from "../tree-helpers";

export type PaperRowActions = {
	downloadingPath: string | null;
	downloadingAll: boolean;
	readingPath: string | null;
	/** Library row shows the bulk download button. */
	showLibraryDownload: boolean;
	/** Any download in flight — disables the Library button. */
	libraryBusy: boolean;
	canDownloadPaper: boolean;
	canReadPaper: boolean;
	downloadPaper: (node: FileNode) => void;
	downloadAllMissing: () => void;
	readPaper: (node: FileNode) => void;
};

export function usePaperRowActions({
	nodes,
	onDownloadPaperAssets,
	onDownloadAllMissingAssets,
	onReadPaper,
}: {
	nodes: FileNode[];
	onDownloadPaperAssets?: (paperNode: FileNode) => Promise<void>;
	onDownloadAllMissingAssets?: () => Promise<void>;
	onReadPaper?: (paperNode: FileNode) => Promise<void>;
}): PaperRowActions {
	const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
	const [downloadingAll, setDownloadingAll] = useState(false);
	const [readingPath, setReadingPath] = useState<string | null>(null);

	const papersNeedingAssets = useMemo(
		() => collectPapersNeedingAssets(nodes),
		[nodes],
	);

	const downloadPaper = useCallback(
		(node: FileNode) => {
			if (!onDownloadPaperAssets || downloadingPath || downloadingAll) return;
			setDownloadingPath(node.path);
			void (async () => {
				try {
					await onDownloadPaperAssets(node);
				} finally {
					setDownloadingPath(null);
				}
			})();
		},
		[onDownloadPaperAssets, downloadingPath, downloadingAll],
	);

	const downloadAllMissing = useCallback(() => {
		if (!onDownloadAllMissingAssets || downloadingAll || downloadingPath)
			return;
		setDownloadingAll(true);
		void (async () => {
			try {
				await onDownloadAllMissingAssets();
			} finally {
				setDownloadingAll(false);
			}
		})();
	}, [onDownloadAllMissingAssets, downloadingAll, downloadingPath]);

	const readPaper = useCallback(
		(node: FileNode) => {
			if (!onReadPaper || readingPath || downloadingPath || downloadingAll)
				return;
			setReadingPath(node.path);
			void (async () => {
				try {
					await onReadPaper(node);
				} finally {
					setReadingPath(null);
				}
			})();
		},
		[onReadPaper, readingPath, downloadingPath, downloadingAll],
	);

	return {
		downloadingPath,
		downloadingAll,
		readingPath,
		showLibraryDownload:
			Boolean(onDownloadAllMissingAssets) && papersNeedingAssets.length > 0,
		libraryBusy: downloadingAll || Boolean(downloadingPath),
		canDownloadPaper: Boolean(onDownloadPaperAssets),
		canReadPaper: Boolean(onReadPaper),
		downloadPaper,
		downloadAllMissing,
		readPaper,
	};
}
