/**
 * Protect tokens that MT engines mangle (inline math, LaTeX commands, URLs,
 * DOIs) by swapping them for opaque placeholders before the request and
 * restoring them afterwards.
 */

export type MaskedToken = {
	placeholder: string;
	original: string;
};

export type MaskedText = {
	text: string;
	tokens: MaskedToken[];
};

export type RestoredText = {
	text: string;
	/** Placeholders the engine dropped or rewrote; caller may retry unmasked. */
	missing: number;
};

/**
 * Mathematical white square brackets: absent from paper prose, and left alone
 * by MT engines far more reliably than ASCII brackets, which collide with
 * citation markers and with the `[[n]]` batch numbering.
 */
function placeholderFor(index: number): string {
	return `⟦${index}⟧`;
}

const MASK_PATTERNS: RegExp[] = [
	// Display / inline TeX math (present when the source came from LaTeX).
	/\$\$[^$]{1,400}\$\$/g,
	/\$[^$\n]{1,200}\$/g,
	/\\\((?:[^\\]|\\[^)]){1,200}?\\\)/g,
	// LaTeX commands with or without a braced argument.
	/\\[A-Za-z]+(?:\{[^{}]{0,120}\})?/g,
	// Links and identifiers.
	/https?:\/\/[^\s、，。]+/g,
	/\bdoi:\s*10\.\d{4,9}\/\S+/gi,
	/\b10\.\d{4,9}\/[^\s、，。]+/g,
];

export function maskInlineTokens(text: string): MaskedText {
	const tokens: MaskedToken[] = [];
	let masked = text;
	for (const pattern of MASK_PATTERNS) {
		masked = masked.replace(
			new RegExp(pattern.source, pattern.flags),
			(hit) => {
				// Already-masked spans must not be re-wrapped by a later pattern.
				if (/^⟦\d+⟧$/.test(hit)) return hit;
				const placeholder = placeholderFor(tokens.length);
				tokens.push({ placeholder, original: hit });
				return placeholder;
			},
		);
	}
	return { text: masked, tokens };
}

export function restoreInlineTokens(
	text: string,
	tokens: readonly MaskedToken[],
): RestoredText {
	let out = text;
	let missing = 0;
	for (const token of tokens) {
		// Engines sometimes pad the brackets ("⟦ 0 ⟧") or drop the token entirely.
		const body = token.placeholder.slice(1, -1);
		if (!new RegExp(`⟦\\s*${body}\\s*⟧`).test(out)) {
			missing += 1;
			continue;
		}
		out = out.replace(
			new RegExp(`⟦\\s*${body}\\s*⟧`, "g"),
			() => token.original,
		);
	}
	return { text: out, missing };
}
