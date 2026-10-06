/**
 * Title-background reading heat for the papers library.
 * Horizontal spine under the title: left = document start, right = end;
 * local color depth = interaction intensity at that position.
 */
import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/core/utils";
import {
	isEmptyHeatmap,
	type ReadingHeatmap,
} from "@/lib/paper/reading-heatmap";

/**
 * Apple system green (HIG / SF Symbols green family).
 * Matches tag palette `green` swatch: ~#34C759 light, close to systemGreen.
 * @see src/lib/ui/tag-colors.ts green token
 */
const APPLE_SYSTEM_GREEN = "oklch(0.65 0.17 145)";

/**
 * Soft light-green fill for one bin intensity (0–1).
 * Low mix keeps the wash pale (浅绿色), not solid system green.
 */
function binFill(intensity: number): string {
	if (intensity <= 0) return "transparent";
	// Soft floor so sparse activity is faintly visible; peak stays restrained.
	const pct = Math.round(12 + intensity * 30); // ~12%–42%
	return `color-mix(in oklch, ${APPLE_SYSTEM_GREEN} ${pct}%, transparent)`;
}

/**
 * Left→right linear-gradient spine from fixed bins.
 * Each bin is a hard stop segment so position along the title maps to the PDF.
 */
function titleReadingSpineStyle(
	bins: readonly number[] | undefined,
): CSSProperties | undefined {
	if (!bins?.length) return undefined;
	let any = false;
	for (const v of bins) {
		if (v > 0) {
			any = true;
			break;
		}
	}
	if (!any) return undefined;

	const n = bins.length;
	const stops: string[] = [];
	for (let i = 0; i < n; i++) {
		const start = (i / n) * 100;
		const end = ((i + 1) / n) * 100;
		const color = binFill(bins[i] ?? 0);
		stops.push(`${color} ${start}%`, `${color} ${end}%`);
	}

	return {
		backgroundImage: `linear-gradient(to right, ${stops.join(", ")})`,
		backgroundRepeat: "no-repeat",
		backgroundSize: "100% 100%",
		borderRadius: "0.2rem",
		boxDecorationBreak: "clone",
		WebkitBoxDecorationBreak: "clone",
	};
}

/**
 * Wraps title text with a document-spine background (front → back) and tooltip.
 * Empty / missing heatmaps render children unchanged (no tooltip).
 */
export function ReadingTitleHeat({
	heatmap,
	children,
	className,
}: {
	heatmap: ReadingHeatmap | null | undefined;
	children: ReactNode;
	className?: string;
}) {
	const { t } = useTranslation("sidebar");
	const empty = isEmptyHeatmap(heatmap);
	const style = empty ? undefined : titleReadingSpineStyle(heatmap?.bins);
	const by = heatmap?.byKind;

	const heatLabel = empty
		? null
		: t("papersLibrary.heatmapTooltip", {
				total: Math.round(heatmap?.total ?? 0),
				highlights: Math.round(by?.highlight ?? 0),
				asks: Math.round(by?.ask ?? 0),
				translates: Math.round(by?.translate ?? 0),
			});

	const text = (
		<span
			className={cn(
				"line-clamp-2 block w-full px-0.5 -mx-0.5",
				style && "rounded-sm",
				className,
			)}
			style={style}
		>
			{children}
		</span>
	);

	if (!heatLabel) return text;

	return (
		<Tooltip>
			<TooltipTrigger asChild>{text}</TooltipTrigger>
			<TooltipContent side="top" className="max-w-xs text-xs">
				{heatLabel}
			</TooltipContent>
		</Tooltip>
	);
}
