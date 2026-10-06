import { Loader2 } from "lucide-react";
import {
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useRef,
} from "react";
import { useTranslation } from "react-i18next";
import { PDF_FLOAT_CARD } from "@/components/viewer/pdf/chrome/pdf-chrome-surface";
import type { ScreenPoint } from "@/components/viewer/pdf/types";
import type { PromptImage } from "@/lib/agent/api";
import { cn } from "@/lib/core/utils";
import type { CrossrefKind } from "@/lib/pdf/citation-dest-keys";

const CARD_WIDTH = 320;
const CARD_ESTIMATED_HEIGHT = 260;

/**
 * Hover card for a `\ref` cross-reference link: a crop of the figure / table /
 * equation / algorithm the link points at. Only mounted when the destination
 * resolved to a layout region; the crop streams in (spinner until ready).
 */
export function PdfCrossrefPreview({
	screen,
	kind,
	page,
	image,
	onPointerEnter,
	onPointerLeave,
}: {
	screen: ScreenPoint;
	kind: CrossrefKind;
	page: number;
	image: PromptImage | null;
	onPointerEnter: () => void;
	onPointerLeave: () => void;
}) {
	const { t } = useTranslation("viewer");
	const rootRef = useRef<HTMLDivElement>(null);
	const viewportWidth =
		typeof window === "undefined" ? 1200 : window.innerWidth;
	const viewportHeight =
		typeof window === "undefined" ? 800 : window.innerHeight;
	const left = Math.min(
		Math.max(12, screen.x),
		viewportWidth - CARD_WIDTH - 12,
	);
	const top = Math.min(
		Math.max(12, screen.y),
		viewportHeight - CARD_ESTIMATED_HEIGHT - 12,
	);
	const kindLabel =
		kind === "figure"
			? t("crossref.kindFigure")
			: kind === "table"
				? t("crossref.kindTable")
				: kind === "equation"
					? t("crossref.kindEquation")
					: t("crossref.kindAlgorithm");

	// Mount under an existing pointer skips pointerenter — re-arm sticky hover.
	useEffect(() => {
		const el = rootRef.current;
		if (!el) return;
		if (el.matches(":hover")) onPointerEnter();
	}, [onPointerEnter]);

	const handlePointerLeave = (e: ReactPointerEvent<HTMLDivElement>) => {
		const next = e.relatedTarget;
		if (next instanceof Node && e.currentTarget.contains(next)) return;
		onPointerLeave();
	};

	return (
		<div
			ref={rootRef}
			role="dialog"
			aria-label={t("crossref.previewLabel")}
			data-pdf-chrome
			className={cn(
				"fixed z-50 w-[320px] p-2",
				PDF_FLOAT_CARD,
				"motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150 motion-reduce:animate-none",
			)}
			style={{ left, top }}
			onPointerEnter={onPointerEnter}
			onPointerLeave={handlePointerLeave}
		>
			<div className="mb-1.5 flex items-center justify-between gap-2 px-1">
				<span className="font-medium text-caption text-foreground">
					{kindLabel}
				</span>
				<span className="text-caption text-muted-foreground tabular-nums">
					{t("figures.page", { page })}
				</span>
			</div>
			<div className="flex max-h-[320px] items-center justify-center overflow-hidden rounded-md bg-muted/40">
				{image ? (
					<img
						src={`data:${image.mimeType};base64,${image.data}`}
						alt={kindLabel}
						className="max-h-[320px] w-full object-contain"
					/>
				) : (
					<div className="flex h-24 items-center justify-center">
						<Loader2
							className="size-4 animate-spin text-muted-foreground"
							aria-label={t("crossref.loading")}
						/>
					</div>
				)}
			</div>
		</div>
	);
}
