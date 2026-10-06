/**
 * Split catalog / display titles that embed TeX math (`$\\pi$`, `$$...$$`,
 * `\\(...\\)`, `\\[...\\]`) into plain-text and math segments for KaTeX.
 *
 * Titles stay single-line in the UI, so every math segment is meant to be
 * rendered with `displayMode: false` even when written as `$$` / `\\[`.
 */

export type TitleMathSegment =
	| { kind: "text"; value: string }
	| { kind: "math"; value: string };

/** True when `text` contains at least one unescaped math delimiter. */
export function hasTitleMath(text: string): boolean {
	if (!text) return false;
	if (text.includes("\\(") || text.includes("\\[")) return true;
	for (let i = 0; i < text.length; i++) {
		if (text[i] !== "$") continue;
		if (i > 0 && text[i - 1] === "\\") continue;
		return true;
	}
	return false;
}

/**
 * Tokenize `input` into text / math segments. Unclosed delimiters are left as
 * plain text so a half-typed `$` does not swallow the rest of the title.
 */
export function parseTitleMath(input: string): TitleMathSegment[] {
	if (!input) return [{ kind: "text", value: "" }];
	if (!hasTitleMath(input)) return [{ kind: "text", value: input }];

	const segments: TitleMathSegment[] = [];
	let cursor = 0;

	const pushText = (value: string) => {
		if (!value) return;
		const last = segments[segments.length - 1];
		if (last?.kind === "text") {
			last.value += value;
			return;
		}
		segments.push({ kind: "text", value });
	};

	while (cursor < input.length) {
		const next = nextMathMatch(input, cursor);
		if (!next) {
			pushText(input.slice(cursor));
			break;
		}
		pushText(input.slice(cursor, next.index));
		segments.push({ kind: "math", value: next.body });
		cursor = next.index + next.consumed;
	}

	return segments.length > 0 ? segments : [{ kind: "text", value: input }];
}

type MathMatch = { index: number; body: string; consumed: number };

/** Earliest closed math span at/after `from`, or null. */
function nextMathMatch(text: string, from: number): MathMatch | null {
	let best: MathMatch | null = null;

	const consider = (match: MathMatch | null) => {
		if (!match) return;
		if (!best || match.index < best.index) best = match;
	};

	consider(matchDollar(text, from));
	consider(matchWrapped(text, from, "\\(", "\\)"));
	consider(matchWrapped(text, from, "\\[", "\\]"));
	return best;
}

function matchDollar(text: string, from: number): MathMatch | null {
	for (let i = from; i < text.length; i++) {
		if (text[i] !== "$") continue;
		if (i > 0 && text[i - 1] === "\\") continue;

		const display = text[i + 1] === "$";
		const openLen = display ? 2 : 1;
		const close = display ? "$$" : "$";
		const bodyStart = i + openLen;
		const closeAt = findDollarCloser(text, bodyStart, close);
		if (closeAt < 0) continue;
		return {
			index: i,
			body: text.slice(bodyStart, closeAt),
			consumed: closeAt + close.length - i,
		};
	}
	return null;
}

function matchWrapped(
	text: string,
	from: number,
	open: string,
	close: string,
): MathMatch | null {
	const index = text.indexOf(open, from);
	if (index < 0) return null;
	const bodyStart = index + open.length;
	const closeAt = text.indexOf(close, bodyStart);
	if (closeAt < 0) return null;
	return {
		index,
		body: text.slice(bodyStart, closeAt),
		consumed: closeAt + close.length - index,
	};
}

function findDollarCloser(text: string, from: number, close: string): number {
	for (let i = from; i <= text.length - close.length; i++) {
		if (!text.startsWith(close, i)) continue;
		if (close === "$") {
			if (i > 0 && text[i - 1] === "\\") continue;
			// Opening was single `$`; a `$$` here is display open, not our close.
			if (text[i + 1] === "$") continue;
		}
		return i;
	}
	return -1;
}
