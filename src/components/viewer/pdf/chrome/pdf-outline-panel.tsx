import type { PdfBookmarkObject } from "@embedpdf/models";
import { OutlineTree } from "@/components/viewer/pdf/chrome/outline-tree";
import { PDF_SIDE_PANEL } from "@/components/viewer/pdf/chrome/pdf-chrome-surface";
import { cn } from "@/lib/core/utils";

type PdfOutlinePanelProps = {
	/** Document bookmarks; both the toggle and the panel hide when empty. */
	outline: PdfBookmarkObject[];
	showOutline: boolean;
	onGoToPage: (page: number) => void;
};

/** Collapsible bookmark sidebar. The toggle button lives in PdfLeftToolbar. */
export function PdfOutlinePanel({
	outline,
	showOutline,
	onGoToPage,
}: PdfOutlinePanelProps) {
	if (!showOutline || outline.length === 0) return null;

	return (
		<aside data-pdf-chrome className={cn("agentero-scroll", PDF_SIDE_PANEL)}>
			<div className="px-2">
				<OutlineTree nodes={outline} depth={0} onGoToPage={onGoToPage} />
			</div>
		</aside>
	);
}
