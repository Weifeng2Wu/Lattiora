/** PDF annotation color palette (highlight fill + underline bar). */

export type HighlightColor = "yellow" | "green" | "blue" | "pink" | "purple";

export const HIGHLIGHT_COLORS: HighlightColor[] = [
	"yellow",
	"green",
	"blue",
	"pink",
	"purple",
];

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = "yellow";

/**
 * Hex colors for EmbedPDF highlight annotations (which persist `strokeColor` as
 * a hex string + separate `opacity`). Kept in sync with the translucent Tailwind
 * fills below so the on-page highlight matches the swatch/palette UI.
 */
export const HIGHLIGHT_HEX: Record<HighlightColor, string> = {
	yellow: "#fcd34d",
	green: "#86efac",
	blue: "#7dd3fc",
	pink: "#f9a8d4",
	purple: "#d8b4fe",
};

/** Default fill opacity for highlight annotations. */
export const HIGHLIGHT_OPACITY = 0.4;

/** Ordered hex list for the annotation plugin's color presets. */
export const HIGHLIGHT_HEX_LIST: string[] = HIGHLIGHT_COLORS.map(
	(c) => HIGHLIGHT_HEX[c],
);

/** Map a stored hex color back to the nearest known palette key. */
export function highlightColorFromHex(hex: string | undefined): HighlightColor {
	if (!hex) return DEFAULT_HIGHLIGHT_COLOR;
	const target = hex.toLowerCase();
	const found = HIGHLIGHT_COLORS.find(
		(c) => HIGHLIGHT_HEX[c].toLowerCase() === target,
	);
	return found ?? DEFAULT_HIGHLIGHT_COLOR;
}

/** Coerce an arbitrary stored color string to a known palette key. */
export function normalizeHighlightColor(
	color: string | undefined,
): HighlightColor {
	return HIGHLIGHT_COLORS.includes(color as HighlightColor)
		? (color as HighlightColor)
		: DEFAULT_HIGHLIGHT_COLOR;
}

// Static class maps (Tailwind cannot see dynamically built class names).
const SWATCH: Record<HighlightColor, string> = {
	yellow: "bg-amber-400",
	green: "bg-green-400",
	blue: "bg-sky-400",
	pink: "bg-pink-400",
	purple: "bg-purple-400",
};

const BORDER: Record<HighlightColor, string> = {
	yellow: "border-amber-400",
	green: "border-green-400",
	blue: "border-sky-400",
	pink: "border-pink-400",
	purple: "border-purple-400",
};

/** Solid dot class for the color picker swatch. */
export function swatchColorClass(color: HighlightColor): string {
	return SWATCH[color];
}

/** Border-color class matching a highlight color (e.g. quoted-text rule). */
export function swatchBorderClass(color: HighlightColor): string {
	return BORDER[color];
}

/** Hover/edit emphasis overlay color. */
export function highlightHoverOverlayColor(color: HighlightColor): string {
	return `${HIGHLIGHT_HEX[color]}80`;
}
