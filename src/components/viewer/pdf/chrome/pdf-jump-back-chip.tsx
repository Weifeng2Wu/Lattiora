/**
 * Floating "jump back" chip shown after an internal link jump (citation,
 * cross-ref, appendix …) moves the reader away from their position (#505).
 *
 * Sits directly under the top-left toolbar, on the same visual column
 * (spatial consistency with the toolbar stack). Stays while the reader
 * scrolls — returning after reading the appendix for a while is the whole
 * point — and disappears once the origin stack is empty. Rendered before the
 * side panels in the DOM so an open panel naturally covers it (z-20).
 *
 * Two layers, like every PDF chip: the material (PDF_CHROME_CHIP) never
 * reacts to hover — feedback is an accent wash on the button inside it.
 */

import { Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PDF_CHROME_CHIP } from "@/components/viewer/pdf/chrome/pdf-chrome-surface";
import { cn } from "@/lib/core/utils";

export type PdfJumpBackChipProps = {
	onGoBack: () => void;
	/** Extra positioning when the viewer composes it inside another layer. */
	className?: string;
};

export function PdfJumpBackChip({ onGoBack, className }: PdfJumpBackChipProps) {
	const { t } = useTranslation("viewer");
	const label = t("pdf.jumpBack");

	return (
		<div
			data-pdf-chrome
			className={cn(
				// Same column as the left toolbar (top-2 + h-7 chip + one unit of
				// breathing room); below the panels' z so an open panel covers it.
				"absolute top-11 left-3 z-20 origin-top-left rounded-lg p-0.5",
				PDF_CHROME_CHIP,
				// Materialize (fade + slight rise toward its own corner), like the
				// find bar; reduced motion collapses to a plain fade.
				"motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200 motion-reduce:animate-none",
				className,
			)}
		>
			<button
				type="button"
				aria-label={label}
				className={cn(
					"flex items-center gap-1.5 rounded-md px-2 py-1 text-caption font-medium",
					"text-muted-foreground",
					// Feedback lives on the press and stays an accent wash on top of
					// the material — the glass itself never changes.
					"transition-[background-color,color,transform] duration-150 ease-out",
					"hover:bg-muted/60 hover:text-foreground",
					"active:bg-muted active:scale-[0.97]",
					"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
				)}
				onClick={onGoBack}
			>
				<Undo2 className="size-3.5 shrink-0" aria-hidden />
				<span className="whitespace-nowrap">{label}</span>
			</button>
		</div>
	);
}
