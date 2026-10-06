/**
 * Focus the Agent composer input (⌘K / ⇧⌘A / palette). React `autoFocus` only fires
 * on mount, and the rail composer stays mounted while hidden, so callers that
 * just expanded the rail need an imperative focus. The composer may appear a few
 * frames later (rail expand + lazy panel), hence the bounded retry.
 *
 * Supports both the legacy textarea and the inline contenteditable field.
 */

export const AGENT_COMPOSER_INPUT_ATTR = "data-agent-composer-input";

const FOCUS_TIMEOUT_MS = 800;

function visibleComposerInput(): HTMLElement | null {
	const nodes = document.querySelectorAll<HTMLElement>(
		`[${AGENT_COMPOSER_INPUT_ATTR}]`,
	);
	for (const node of nodes) {
		if (node.offsetParent !== null) return node;
	}
	return null;
}

function placeCaretAtEnd(el: HTMLElement) {
	if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
		const len = el.value.length;
		el.setSelectionRange(len, len);
		return;
	}
	const selection = window.getSelection();
	if (!selection) return;
	const range = document.createRange();
	range.selectNodeContents(el);
	range.collapse(false);
	selection.removeAllRanges();
	selection.addRange(range);
}

export function focusAgentComposer(): void {
	if (typeof document === "undefined") return;
	const deadline = Date.now() + FOCUS_TIMEOUT_MS;
	const attempt = () => {
		const input = visibleComposerInput();
		if (input) {
			input.focus();
			placeCaretAtEnd(input);
			return;
		}
		if (Date.now() < deadline) requestAnimationFrame(attempt);
	};
	requestAnimationFrame(attempt);
}
