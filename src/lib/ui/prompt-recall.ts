/**
 * Shared “↑ / ↓ recalls previous user prompts into the composer” helpers.
 *
 * Shell / ChatGPT-style: when the input is empty and the caret is at the start,
 * ArrowUp fills the textarea with the last user message; further ArrowUp walks
 * older messages; ArrowDown walks newer messages and finally restores the draft.
 * (Inline edit-and-resend of a bubble remains a separate Pencil action.)
 */

export type PromptRecallCaretTarget = {
	value: string;
	selectionStart: number | null;
	selectionEnd: number | null;
};

type RoleLike = { role?: string; kind?: string; text?: string };

/**
 * Whether ArrowUp should start / continue prompt history navigation.
 * First entry requires empty (whitespace-only) input; while browsing, caret
 * must stay at the start (so multi-line messages can still move the caret).
 */
export function shouldNavigateHistoryUp(
	event: { key: string },
	el: PromptRecallCaretTarget,
	isBrowsing: boolean,
): boolean {
	if (event.key !== "ArrowUp") return false;
	const start = el.selectionStart ?? 0;
	const end = el.selectionEnd ?? 0;
	if (start !== 0 || end !== 0) return false;
	if (isBrowsing) return true;
	return el.value.trim() === "";
}

/**
 * Whether ArrowDown should walk toward newer history / restore the draft.
 * Only while browsing, and only when the caret is at the end of the value.
 */
export function shouldNavigateHistoryDown(
	event: { key: string },
	el: PromptRecallCaretTarget,
	isBrowsing: boolean,
): boolean {
	if (event.key !== "ArrowDown") return false;
	if (!isBrowsing) return false;
	const len = el.value.length;
	const start = el.selectionStart ?? 0;
	const end = el.selectionEnd ?? 0;
	return start === len && end === len;
}

/**
 * @deprecated Prefer {@link shouldNavigateHistoryUp}. Kept for PDF Ask which
 * still uses empty-input + ↑ to open inline edit.
 */
export function shouldRecallPreviousPrompt(
	event: { key: string },
	el: PromptRecallCaretTarget,
): boolean {
	return shouldNavigateHistoryUp(event, el, false);
}

/** Index of the last user message, or -1. */
export function findLastUserMessageIndex(
	messages: readonly RoleLike[],
): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role === "user" || m.kind === "user") return i;
	}
	return -1;
}

/**
 * Collect user-visible prompt texts in chronological order (oldest first).
 * `displayText` strips host envelopes when provided.
 */
export function collectUserPromptTexts(
	messages: readonly RoleLike[],
	displayText?: (raw: string) => string,
): string[] {
	const out: string[] = [];
	for (const m of messages) {
		if (m.role !== "user" && m.kind !== "user") continue;
		const raw = typeof m.text === "string" ? m.text : "";
		const text = (displayText ? displayText(raw) : raw).trim();
		if (text) out.push(text);
	}
	return out;
}

/**
 * Next history index after ArrowUp (`null` current = not browsing).
 * Index is into an oldest-first list; first Up selects the newest entry.
 * Stays on the oldest when already there.
 */
export function nextHistoryIndexOnUp(
	promptCount: number,
	currentIndex: number | null,
): number | null {
	if (promptCount <= 0) return null;
	if (currentIndex === null) return promptCount - 1;
	if (currentIndex <= 0) return 0;
	return currentIndex - 1;
}

/**
 * Next history index after ArrowDown.
 * Returns `null` when the user steps past the newest entry (restore draft).
 */
export function nextHistoryIndexOnDown(
	promptCount: number,
	currentIndex: number | null,
): number | null {
	if (currentIndex === null || promptCount <= 0) return null;
	if (currentIndex >= promptCount - 1) return null;
	return currentIndex + 1;
}

/** Place the caret at the end of a controlled textarea after React commits. */
export function placeCaretAtEnd(el: HTMLTextAreaElement | null, text: string) {
	if (!el) return;
	const len = text.length;
	requestAnimationFrame(() => {
		try {
			el.setSelectionRange(len, len);
		} catch {
			// ignore detached / non-focusable nodes
		}
	});
}
