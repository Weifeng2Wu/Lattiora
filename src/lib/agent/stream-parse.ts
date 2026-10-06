/**
 * Stream helpers for agent chat turns.
 *
 * Some models (notably DeepSeek-R1 style) either:
 * 1. Embed thinking in message text with <think>...</think> tags, or
 * 2. Mis-route the entire answer through ACP AgentThoughtChunk (kind=thought),
 *    leaving no message body — the UI then shows the answer only under Thinking.
 */

const OPEN_TAGS = ["<think>", "<thinking>", "<reasoning>"] as const;
const CLOSE_TAGS = ["</think>", "</thinking>", "</reasoning>"] as const;

export type StreamPartKind = "reasoning" | "text";

export type StreamSlice = {
	kind: StreamPartKind;
	text: string;
};

/** Stateful parser for think-style tags inside message (or thought) chunks. */
export class ThinkTagParser {
	private inThink = false;
	/** Incomplete tag prefix held across chunk boundaries. */
	private hold = "";

	reset() {
		this.inThink = false;
		this.hold = "";
	}

	/**
	 * Feed a raw chunk; returns zero or more ordered slices tagged as
	 * reasoning vs assistant text.
	 */
	push(chunk: string): StreamSlice[] {
		const input = this.hold + chunk;
		this.hold = "";
		const out: StreamSlice[] = [];
		let i = 0;
		let buf = "";
		const flush = (kind: StreamPartKind) => {
			if (!buf) return;
			out.push({ kind, text: buf });
			buf = "";
		};

		while (i < input.length) {
			if (!this.inThink) {
				const open = findEarliest(input, i, OPEN_TAGS);
				if (!open) {
					// May end mid-open-tag
					const partial = longestPartialSuffix(input.slice(i), OPEN_TAGS);
					if (partial > 0) {
						buf += input.slice(i, input.length - partial);
						flush("text");
						this.hold = input.slice(input.length - partial);
						return out;
					}
					buf += input.slice(i);
					flush("text");
					return out;
				}
				buf += input.slice(i, open.index);
				flush("text");
				this.inThink = true;
				i = open.index + open.tag.length;
			} else {
				const close = findEarliest(input, i, CLOSE_TAGS);
				if (!close) {
					const partial = longestPartialSuffix(input.slice(i), CLOSE_TAGS);
					if (partial > 0) {
						buf += input.slice(i, input.length - partial);
						flush("reasoning");
						this.hold = input.slice(input.length - partial);
						return out;
					}
					buf += input.slice(i);
					flush("reasoning");
					return out;
				}
				buf += input.slice(i, close.index);
				flush("reasoning");
				this.inThink = false;
				i = close.index + close.tag.length;
			}
		}
		return out;
	}
}

function findEarliest(
	s: string,
	from: number,
	tags: readonly string[],
): { index: number; tag: string } | null {
	let best: { index: number; tag: string } | null = null;
	const lower = s.toLowerCase();
	for (const tag of tags) {
		const idx = lower.indexOf(tag.toLowerCase(), from);
		if (idx >= 0 && (best === null || idx < best.index)) {
			best = { index: idx, tag: s.slice(idx, idx + tag.length) };
		}
	}
	return best;
}

/** Length of the longest proper prefix of any tag that is a suffix of `s`. */
function longestPartialSuffix(s: string, tags: readonly string[]): number {
	const lower = s.toLowerCase();
	let max = 0;
	for (const tag of tags) {
		const t = tag.toLowerCase();
		const maxLen = Math.min(lower.length, t.length - 1);
		for (let len = maxLen; len > 0; len--) {
			if (lower.endsWith(t.slice(0, len))) {
				max = Math.max(max, len);
				break;
			}
		}
	}
	return max;
}

/**
 * When a turn finished with only "reasoning" parts and no assistant text
 * (and final content is also empty), promote the last reasoning block to text.
 * Keeps earlier reasoning blocks as thinking when multiple exist.
 *
 * Fixes ACP adapters that emit the final answer only as AgentThoughtChunk
 * (observed with DeepSeek via some agents).
 */
export function promoteOrphanThoughtToText<
	T extends { type: string; text?: string },
>(parts: T[]): T[] {
	const text = parts
		.filter((p) => p.type === "text")
		.map((p) => p.text ?? "")
		.join("")
		.trim();
	if (text) return parts;

	const reasoningIdxs: number[] = [];
	parts.forEach((p, i) => {
		if (p.type === "reasoning" && (p.text ?? "").trim()) reasoningIdxs.push(i);
	});
	if (reasoningIdxs.length === 0) return parts;

	const lastIdx = reasoningIdxs[reasoningIdxs.length - 1];
	const next = parts.slice();
	const last = next[lastIdx];
	next[lastIdx] = { ...last, type: "text" };
	return next;
}

/**
 * Classify a stream event into slices for the UI.
 * - thought kind: always reasoning (ACP thought channel)
 * - message kind: split on <think>…</think> tags when present
 */
export function classifyStreamChunk(
	kind: "message" | "thought" | string | undefined,
	chunk: string,
	parser: ThinkTagParser,
): StreamSlice[] {
	if (!chunk) return [];
	// ACP thought channel is already classified — do not re-tag as text.
	// (DeepSeek mis-routes are fixed at completion via promoteOrphanThoughtToText.)
	if (kind === "thought") {
		return [{ kind: "reasoning", text: chunk }];
	}
	// Message channel: split <think>…</think> (DeepSeek / Qwen-style tags).
	return parser.push(chunk);
}
