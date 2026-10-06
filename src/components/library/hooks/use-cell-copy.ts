/**
 * Row interactions for the library table.
 *
 * - Single-click a row opens the paper after a short delay.
 * - Double-click a cell copies that field; the second click cancels the pending
 *   open so a copy never also opens the paper.
 * - Direct open (context menu) cancels any pending open.
 */
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useRef } from "react";
import type { CellT } from "@/components/library/library-row-utils";
import { copyTextToClipboard } from "@/lib/core/clipboard";
import type { PaperMetadata } from "@/lib/paper";

/**
 * Delay before committing a single-click open.
 * Must outlast a typical double-click interval so a double-click copy can
 * cancel the open before it fires.
 */
const ROW_OPEN_CLICK_DELAY_MS = 320;

export function useCellCopy({
	t,
	onOpenPaper,
}: {
	t: CellT;
	onOpenPaper: (paper: PaperMetadata) => void;
}) {
	/** Pending row-open timer — cleared by a double-click or direct open. */
	const pendingOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	const cancelPendingOpen = useCallback(() => {
		if (pendingOpenTimerRef.current != null) {
			clearTimeout(pendingOpenTimerRef.current);
			pendingOpenTimerRef.current = null;
		}
	}, []);

	useEffect(() => () => cancelPendingOpen(), [cancelPendingOpen]);

	/** Double-click a cell → copy that field; skip empty values. */
	const copyField = useCallback(
		async (text: string | null | undefined, label: string) => {
			const value = text?.trim();
			if (!value) return;
			await copyTextToClipboard(value, {
				successMessage: t("papersLibrary.copied", { label }),
				errorMessage: t("papersLibrary.copyFailed"),
				successNotify: {
					duration: 1500,
					id: "papers-library-copied",
				},
			});
		},
		[t],
	);

	/** Double-click a cell → copy immediately. */
	const onCellCopy = useCallback(
		(text: string | null | undefined, label: string) => {
			void copyField(text, label);
		},
		[copyField],
	);

	/**
	 * Single-click a row → schedule open. Double-click (detail > 1) cancels the
	 * pending open so copying a cell does not also open the paper.
	 */
	const onRowClick = useCallback(
		(e: ReactMouseEvent, paper: PaperMetadata) => {
			if (e.detail > 1) {
				cancelPendingOpen();
				return;
			}
			cancelPendingOpen();
			pendingOpenTimerRef.current = setTimeout(() => {
				pendingOpenTimerRef.current = null;
				onOpenPaper(paper);
			}, ROW_OPEN_CLICK_DELAY_MS);
		},
		[cancelPendingOpen, onOpenPaper],
	);

	/** Direct open from the context menu — cancel any pending click-open first. */
	const openPaperFromRow = useCallback(
		(paper: PaperMetadata) => {
			cancelPendingOpen();
			onOpenPaper(paper);
		},
		[cancelPendingOpen, onOpenPaper],
	);

	return { onCellCopy, onRowClick, openPaperFromRow };
}
