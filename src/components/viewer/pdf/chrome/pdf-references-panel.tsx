import { ReferencesPanel } from "@/components/viewer/panels/references-panel";
import { PDF_SIDE_PANEL } from "@/components/viewer/pdf/chrome/pdf-chrome-surface";
import { cn } from "@/lib/core/utils";

type PdfReferencesPanelProps = {
	vaultPath: string | null;
	paperPath: string | null;
	showReferences: boolean;
};

/** Left-side citation panel. The toggle button lives in PdfLeftToolbar. */
export function PdfReferencesPanel({
	vaultPath,
	paperPath,
	showReferences,
}: PdfReferencesPanelProps) {
	if (!showReferences || !paperPath) return null;

	return (
		<aside data-pdf-chrome className={cn("agentero-scroll", PDF_SIDE_PANEL)}>
			<ReferencesPanel
				vaultPath={vaultPath}
				paperPath={paperPath}
				className="h-full"
				compact
			/>
		</aside>
	);
}
