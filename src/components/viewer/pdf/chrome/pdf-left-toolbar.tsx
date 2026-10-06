import type { PdfBookmarkObject } from "@embedpdf/models";
import { BookMarked, Boxes, List } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	PDF_CHROME_CHIP,
	PDF_CHROME_VIS,
	PDF_CHROME_VIS_HIDE,
	PDF_CHROME_VIS_SHOW,
} from "@/components/viewer/pdf/chrome/pdf-chrome-surface";
import { cn } from "@/lib/core/utils";

type PdfLeftToolbarProps = {
	outline: PdfBookmarkObject[];
	showOutline: boolean;
	onToggleOutline: () => void;
	paperPath: string | null;
	showReferences: boolean;
	onToggleReferences: () => void;
	showFigures: boolean;
	onToggleFigures: () => void;
	analyzing?: boolean;
	/** Auto show/hide driven by scroll + pointer proximity (issue #400). */
	visible: boolean;
	/** True for remote papers with no local sidecar. */
	isRemotePaper?: boolean;
	/** True for PDFs outside papers/: no figures/layout-analysis entry. */
	plainViewer?: boolean;
};

/** Top-left toggle group: outline, references, figures. Buttons are only
 *  rendered when their feature is available, and the flex layout keeps the
 *  visible ones aligned without fixed left-offset magic numbers. */
export function PdfLeftToolbar({
	outline,
	showOutline,
	onToggleOutline,
	paperPath,
	showReferences,
	onToggleReferences,
	showFigures,
	onToggleFigures,
	analyzing,
	visible,
	isRemotePaper = false,
	plainViewer = false,
}: PdfLeftToolbarProps) {
	const { t } = useTranslation("viewer");
	const hasOutline = outline.length > 0;

	return (
		<div
			className={cn(
				"pointer-events-none absolute top-2 left-3 z-30 origin-top-left",
				PDF_CHROME_VIS,
				visible ? PDF_CHROME_VIS_SHOW : PDF_CHROME_VIS_HIDE,
			)}
		>
			<TooltipProvider delayDuration={200}>
				<div
					data-pdf-chrome
					className={cn(
						"flex h-7 select-none items-center gap-0.5 rounded-lg p-0.5",
						PDF_CHROME_CHIP,
						visible ? "pointer-events-auto" : "pointer-events-none",
					)}
				>
					{hasOutline ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									size="icon-xs"
									variant={showOutline ? "secondary" : "ghost"}
									aria-label={t("pdf.outline")}
									aria-pressed={showOutline}
									onClick={onToggleOutline}
								>
									<List className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">{t("pdf.outline")}</TooltipContent>
						</Tooltip>
					) : null}
					{paperPath ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									size="icon-xs"
									variant={showReferences ? "secondary" : "ghost"}
									aria-label={t("references.title")}
									aria-pressed={showReferences}
									onClick={onToggleReferences}
								>
									<BookMarked className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">
								{t("references.title")}
							</TooltipContent>
						</Tooltip>
					) : null}
					{!plainViewer ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									size="icon-xs"
									variant={showFigures ? "secondary" : "ghost"}
									aria-label={t("figures.title")}
									aria-pressed={showFigures}
									disabled={analyzing || isRemotePaper}
									onClick={onToggleFigures}
								>
									<Boxes className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">
								{t("figures.title")}
							</TooltipContent>
						</Tooltip>
					) : null}
				</div>
			</TooltipProvider>
		</div>
	);
}
