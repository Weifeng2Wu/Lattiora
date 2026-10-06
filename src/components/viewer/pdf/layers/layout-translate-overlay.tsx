/**
 * Progressive translation overlays for layout body-text regions.
 * Full bbox stays covered (hides source PDF text); font size tracks paper
 * body size, then re-fits so the translation fills the block without huge gaps.
 */

import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/core/utils";
import { isLayoutTranslateHeadingKind } from "@/lib/pdf/layout/labels";
import type { LayoutTranslateItem } from "@/lib/pdf/layout/layout-translate";
import type { PdfLayoutRegion } from "@/lib/pdf/layout/types";
import {
	PDF_PAGE_RASTER_DARK_CLASS,
	PDF_PAPER_BLOCK_CLASS,
	type PdfPaperTone,
} from "@/lib/pdf/page-theme";

type LayoutTranslateOverlayProps = {
	/** Items already bucketed for this one page (groupLayoutTranslateItemsByPage). */
	items: readonly LayoutTranslateItem[];
	/** Page pixel size (for font-size heuristic). */
	pageWidthPx: number;
	pageHeightPx: number;
	/** Match PDF page paper (not app chrome). */
	tone?: PdfPaperTone;
	/** Raw page regions; used as collision blockers for safe overlay expansion. */
	layoutRegions?: readonly PdfLayoutRegion[];
};

const LINE_HEIGHT = 1.25;
/**
 * Heuristic floor. A DOM-measured second pass below may go lower only when the
 * real browser metrics prove the text would otherwise be clipped.
 */
const FS_MIN = 4;
const FS_MAX = 20;
const FIT_SAFETY = 0.97;
const DOM_FIT_ABSOLUTE_MIN = 1;
const DOM_FIT_EPSILON_PX = 0.5;
/**
 * Keep the source paragraph's leading whenever possible. If translation
 * expands, BabelDOC's typesetter reduces leading before it reduces glyph
 * scale; doing the same here preserves a much more paper-like hierarchy than
 * immediately making a dense CJK paragraph tiny.
 */
const DOM_FIT_LINE_HEIGHTS = [LINE_HEIGHT, 1.2, 1.15, 1.1] as const;
const OVERLAY_PAGE_RIGHT = 0.97;
const OVERLAY_GUTTER = 0.006;

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
	return Math.min(aEnd, bEnd) - Math.max(aStart, bStart) > 0;
}

/**
 * Conservative counterpart to BabelDOC's paragraph-box expansion. We never
 * cross a detected layout region and cap each direction at half the original
 * box, so a missed detection cannot turn one translated label into a page-wide
 * white slab.
 */
export function expandLayoutTranslateBbox(
	item: LayoutTranslateItem,
	blockers: readonly PdfLayoutRegion[] = [],
): LayoutTranslateItem["bbox"] {
	const translated = item.translated?.trim();
	const sourceWidth =
		item.source.replace(/\s+/g, "").length * avgGlyphEm(item.source);
	const translatedWidth = translated
		? translated.replace(/\s+/g, "").length * avgGlyphEm(translated)
		: 0;
	// Raw layout boxes are reliable collision blockers for titles/captions, but
	// not sufficiently complete to safely borrow space for body prose. Expand
	// only when translated glyph width genuinely exceeds the source by 10%.
	const expandable =
		(isLayoutTranslateHeadingKind(item.kind) || item.kind === "figure_title") &&
		translatedWidth > sourceWidth * 1.1;
	if (!expandable) return item.bbox;
	const original = item.bbox;
	const x2 = original.x + original.w;
	const y2 = original.y + original.h;
	let right = OVERLAY_PAGE_RIGHT;
	let bottom = 1 - OVERLAY_GUTTER;
	for (const blocker of blockers) {
		if (blocker.id === item.id) continue;
		const b = blocker.bbox;
		if (
			b.x >= x2 - OVERLAY_GUTTER &&
			overlaps(original.y, y2, b.y, b.y + b.h)
		) {
			right = Math.min(right, b.x - OVERLAY_GUTTER);
		}
		if (
			b.y >= y2 - OVERLAY_GUTTER &&
			overlaps(original.x, x2, b.x, b.x + b.w)
		) {
			bottom = Math.min(bottom, b.y - OVERLAY_GUTTER);
		}
	}
	const width = Math.max(
		original.w,
		Math.min(right - original.x, original.w * 1.5),
	);
	// Prefer one-direction expansion. Expanding both could cover a diagonal
	// figure/table that does not overlap the original narrow title box.
	if (width > original.w + 0.001) return { ...original, w: width };
	return {
		...original,
		h: Math.max(original.h, Math.min(bottom - original.y, original.h * 1.75)),
	};
}

/** Wider glyphs for CJK; narrower for Latin (academic body). */
function avgGlyphEm(text: string): number {
	const t = text.replace(/\s+/g, "");
	if (!t.length) return 0.58;
	const cjk = (t.match(/[\u3000-\u9fff\u3400-\u4dbf]/g) ?? []).length;
	const ratio = cjk / t.length;
	// Slightly conservative widths avoid an optimistic fit estimate followed by
	// CSS overflow clipping at real browser font metrics.
	return 0.55 * (1 - ratio) + 1 * ratio;
}

function estimateLineCount(
	text: string,
	widthPx: number,
	fontSize: number,
	glyphEm: number,
): number {
	const explicit = text.split(/\n/).filter(Boolean);
	if (explicit.length > 1) {
		let lines = 0;
		const cpl = Math.max(1, Math.floor(widthPx / (fontSize * glyphEm)));
		for (const part of explicit) {
			lines += Math.max(1, Math.ceil(part.replace(/\s+/g, "").length / cpl));
		}
		return Math.max(1, lines);
	}
	const chars = Math.max(1, text.replace(/\s+/g, "").length);
	const cpl = Math.max(1, Math.floor(widthPx / (fontSize * glyphEm)));
	return Math.max(1, Math.ceil(chars / cpl));
}

function estimateBlockHeight(
	text: string,
	widthPx: number,
	fontSize: number,
	glyphEm: number,
): number {
	const lines = estimateLineCount(text, widthPx, fontSize, glyphEm);
	return lines * fontSize * LINE_HEIGHT;
}

/**
 * Largest font size such that wrapped `text` still fits in (widthPx × heightPx).
 */
function fitFontSizeToBox(
	text: string,
	widthPx: number,
	heightPx: number,
	glyphEm: number,
): number {
	const content = text.replace(/\s+/g, " ").trim() || "…";
	let lo = FS_MIN;
	let hi = FS_MAX;
	// 12 iterations → sub-pixel precision for UI.
	for (let i = 0; i < 12; i++) {
		const mid = (lo + hi) / 2;
		const h = estimateBlockHeight(content, widthPx, mid, glyphEm);
		if (h <= heightPx) lo = mid;
		else hi = mid;
	}
	return Math.max(FS_MIN, lo * FIT_SAFETY);
}

/**
 * Paper-like size from the English/source block, then adjust for the
 * translation so CN denser text does not leave a half-empty white slab.
 */
export function fontSizeForLayoutTranslateBox(
	bbox: LayoutTranslateItem["bbox"],
	pageWidthPx: number,
	pageHeightPx: number,
	source: string,
	translated?: string,
): number {
	const padX = 4;
	const padY = 3;
	const w = Math.max(1, bbox.w * pageWidthPx - padX);
	const h = Math.max(1, bbox.h * pageHeightPx - padY);
	const src = source.replace(/\s+/g, " ").trim() || "x";
	const display = translated?.replace(/\s+/g, " ").trim() || src || "…";

	const srcEm = avgGlyphEm(src);
	const dispEm = avgGlyphEm(display);

	// 1) Size the original paper body would use in this bbox.
	const paperFs = fitFontSizeToBox(src, w, h, srcEm);

	// 2) Largest size that still fits the translation in the same box.
	const fitFs = fitFontSizeToBox(display, w, h, dispEm);

	// 3) Prefer paper-like; shrink if translation would overflow; allow modest
	//    grow when translation is denser (CN) so the block is not half blank.
	let fs = paperFs;
	if (fitFs < paperFs * 0.98) {
		// Translation longer / wider glyphs → must shrink.
		fs = fitFs;
	} else if (fitFs > paperFs * 1.05) {
		// Room to grow: fill up toward ~90% of the max fit, capped at 1.22× paper.
		fs = Math.min(fitFs * 0.9, paperFs * 1.22);
	}

	// Tiny header strips: use most of the strip height.
	const srcLines = estimateLineCount(src, w, Math.max(paperFs, 8), srcEm);
	if (srcLines === 1 && src.length < 100 && h < 40) {
		fs = Math.min(fitFs, Math.max(fs, h * 0.7));
	}

	return Math.max(FS_MIN, Math.min(FS_MAX, fs));
}

/**
 * Fit-result cache. Streaming job updates repaint every mounted page, but the
 * fitted size only depends on (item, box pixel size, source, text), so
 * unchanged blocks reuse their last result instead of re-running the
 * binary-search fit on every render. Inner maps use raw strings as keys
 * (value equality), so cache hits build no large key strings. Bounded:
 * oldest item entries are evicted first; per-item maps hold only the few
 * text variants a block goes through (placeholder → final).
 */
const FONT_SIZE_CACHE_MAX_ITEMS = 1024;
const FONT_SIZE_CACHE_MAX_SOURCES = 8;
const FONT_SIZE_CACHE_MAX_TEXTS = 32;

type FontSizeCacheEntry = {
	boxWidthPx: number;
	boxHeightPx: number;
	bySource: Map<string, Map<string, number>>;
};

const fontSizeCache = new Map<string, FontSizeCacheEntry>();

function fontSizeForLayoutTranslateItem(
	item: LayoutTranslateItem,
	pageWidthPx: number,
	pageHeightPx: number,
	text: string,
): number {
	const boxWidthPx = item.bbox.w * pageWidthPx;
	const boxHeightPx = item.bbox.h * pageHeightPx;
	let entry = fontSizeCache.get(item.id);
	if (!entry) {
		if (fontSizeCache.size >= FONT_SIZE_CACHE_MAX_ITEMS) {
			const oldest = fontSizeCache.keys().next().value;
			if (oldest !== undefined) fontSizeCache.delete(oldest);
		}
		entry = { boxWidthPx, boxHeightPx, bySource: new Map() };
		fontSizeCache.set(item.id, entry);
	} else if (
		entry.boxWidthPx !== boxWidthPx ||
		entry.boxHeightPx !== boxHeightPx
	) {
		// Zoom or region geometry changed: cached sizes no longer apply.
		entry.boxWidthPx = boxWidthPx;
		entry.boxHeightPx = boxHeightPx;
		entry.bySource.clear();
	}
	let byText = entry.bySource.get(item.source);
	if (!byText) {
		if (entry.bySource.size >= FONT_SIZE_CACHE_MAX_SOURCES) {
			entry.bySource.clear();
		}
		byText = new Map();
		entry.bySource.set(item.source, byText);
	}
	const hit = byText.get(text);
	if (hit !== undefined) return hit;
	const fontSize = fontSizeForLayoutTranslateBox(
		item.bbox,
		pageWidthPx,
		pageHeightPx,
		item.source,
		text,
	);
	if (byText.size >= FONT_SIZE_CACHE_MAX_TEXTS) byText.clear();
	byText.set(text, fontSize);
	return fontSize;
}

function elementFitsBox(element: HTMLParagraphElement): boolean {
	return (
		element.scrollHeight <= element.clientHeight + DOM_FIT_EPSILON_PX &&
		element.scrollWidth <= element.clientWidth + DOM_FIT_EPSILON_PX
	);
}

function applyParagraphMetrics(
	element: HTMLParagraphElement,
	fontSize: number,
	lineHeight: number,
): void {
	element.style.fontSize = `${fontSize}px`;
	element.style.lineHeight = String(lineHeight);
}

type ExactFitParagraphProps = {
	text: string;
	initialFontSize: number;
	boxWidthPx: number;
	boxHeightPx: number;
	isHeading: boolean;
};

/**
 * The heuristic above is fast but font metrics differ across Windows/macOS,
 * installed CJK fonts, and zoom levels. Verify the final browser layout and, if
 * necessary, binary-search the actual DOM font size so `overflow-hidden` never
 * silently chops off an otherwise complete translation.
 */
export const LayoutTranslateParagraph = memo(function LayoutTranslateParagraph({
	text,
	initialFontSize,
	boxWidthPx,
	boxHeightPx,
	isHeading,
}: ExactFitParagraphProps) {
	const ref = useRef<HTMLParagraphElement>(null);

	useLayoutEffect(() => {
		const element = ref.current;
		if (!element || boxWidthPx <= 0 || boxHeightPx <= 0) return;
		// Wait until React has committed the text this fit pass is measuring.
		if (element.textContent !== text) return;

		// Preserve source-like leading first. Reducing line-height is markedly
		// less harmful to the page's visual hierarchy than shrinking every glyph.
		let lineHeight = LINE_HEIGHT;
		for (const candidate of DOM_FIT_LINE_HEIGHTS) {
			applyParagraphMetrics(element, initialFontSize, candidate);
			if (elementFitsBox(element)) return;
			lineHeight = candidate;
		}

		let lo = DOM_FIT_ABSOLUTE_MIN;
		let hi = initialFontSize;
		let best = DOM_FIT_ABSOLUTE_MIN;
		applyParagraphMetrics(element, lo, lineHeight);

		// An unbreakable URL / identifier can exceed the box at every readable
		// size. Only then relax normal word boundaries, mirroring BabelDOC's final
		// fallback after its language-aware line-break pass.
		if (!elementFitsBox(element)) {
			element.style.overflowWrap = "anywhere";
			for (const candidate of DOM_FIT_LINE_HEIGHTS) {
				applyParagraphMetrics(element, lo, candidate);
				if (elementFitsBox(element)) {
					lineHeight = candidate;
					break;
				}
			}
			if (!elementFitsBox(element)) return;
		}

		for (let i = 0; i < 10; i++) {
			const mid = (lo + hi) / 2;
			applyParagraphMetrics(element, mid, lineHeight);
			if (elementFitsBox(element)) {
				best = mid;
				lo = mid;
			} else {
				hi = mid;
			}
		}
		applyParagraphMetrics(
			element,
			Math.max(DOM_FIT_ABSOLUTE_MIN, best * FIT_SAFETY),
			lineHeight,
		);
	}, [boxHeightPx, boxWidthPx, initialFontSize, text]);

	return (
		<p
			ref={ref}
			className={cn(
				"m-0 h-full w-full select-text overflow-hidden whitespace-pre-wrap",
				isHeading && "font-bold",
			)}
			style={{
				fontSize: initialFontSize,
				lineHeight: LINE_HEIGHT,
				// Browser-native UAX #14 breaking avoids a CJK opening bracket at a
				// line end and keeps Latin words intact until the measured fallback.
				lineBreak: "strict",
				wordBreak: "normal",
				overflowWrap: "normal",
			}}
		>
			{text}
		</p>
	);
});

/**
 * Paint translated (or in-flight) blocks for one PDF page.
 */
export const LayoutTranslateOverlay = memo(function LayoutTranslateOverlay({
	items,
	pageWidthPx,
	pageHeightPx,
	tone = "white",
	layoutRegions,
}: LayoutTranslateOverlayProps) {
	const onPage = useMemo(
		() =>
			items
				.filter(
					(it) =>
						it.status === "done" ||
						it.status === "running" ||
						(it.status === "error" && it.translated),
				)
				.map((item) => ({
					...item,
					bbox: expandLayoutTranslateBbox(item, layoutRegions),
				})),
		[items, layoutRegions],
	);
	if (onPage.length === 0) return null;

	return (
		<>
			{onPage.map((item) => {
				const text =
					item.status === "running"
						? (item.translated ?? "…")
						: (item.translated ?? "");
				const isHeading = isLayoutTranslateHeadingKind(item.kind);
				const fontSize = fontSizeForLayoutTranslateItem(
					item,
					pageWidthPx,
					pageHeightPx,
					text,
				);
				const boxWidthPx = item.bbox.w * pageWidthPx;
				const boxHeightPx = item.bbox.h * pageHeightPx;
				return (
					<div
						key={`layout-tr-${item.id}`}
						className={cn(
							"pointer-events-none absolute z-[3] overflow-hidden rounded-[1px]",
							// Blocks are opaque paper: paint the active tone, and invert in
							// dark mode exactly like the page rasters so they still match.
							PDF_PAPER_BLOCK_CLASS[tone],
							"text-zinc-900",
							tone === "dark" && PDF_PAGE_RASTER_DARK_CLASS,
							item.status === "running" && "opacity-90",
						)}
						style={{
							left: `${item.bbox.x * 100}%`,
							top: `${item.bbox.y * 100}%`,
							width: `${item.bbox.w * 100}%`,
							height: `${item.bbox.h * 100}%`,
							padding: "1px 2px",
							fontSize,
							lineHeight: LINE_HEIGHT,
							// Serif stack closer to paper body than UI sans.
							fontFamily:
								'ui-serif, "Times New Roman", Times, "Noto Serif SC", "Songti SC", "Source Han Serif SC", serif',
							// Titles / section headers: bold; body justified.
							fontWeight: isHeading ? 700 : 400,
							textAlign: isHeading ? "left" : "justify",
						}}
						aria-hidden="true"
					>
						<LayoutTranslateParagraph
							text={text}
							initialFontSize={fontSize}
							boxWidthPx={boxWidthPx}
							boxHeightPx={boxHeightPx}
							isHeading={isHeading}
						/>
					</div>
				);
			})}
		</>
	);
});
