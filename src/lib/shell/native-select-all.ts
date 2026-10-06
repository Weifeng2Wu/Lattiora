/**
 * Decide whether the browser's native ⌘A / Ctrl+A should run.
 *
 * Desktop chrome is mostly `user-select: none`, but leftover labels and
 * third-party layers still participate in document-wide Select All. Allow the
 * shortcut only inside real text surfaces (inputs, editors, opt-in
 * `.select-text` / `.select-all`).
 */

const NATIVE_SELECT_ALL_SELECTOR = [
	"input",
	"textarea",
	"select",
	"[contenteditable]:not([contenteditable='false'])",
	"[role='textbox']",
	".select-text",
	".select-all",
].join(", ");

/** True when ⌘A / Ctrl+A should keep the browser's default select-all. */
export function allowsNativeSelectAll(target: EventTarget | null): boolean {
	// Duck-type: Node unit tests have no DOM `Element` global.
	if (
		!target ||
		typeof (target as { closest?: unknown }).closest !== "function"
	) {
		return false;
	}
	return Boolean((target as Element).closest(NATIVE_SELECT_ALL_SELECTOR));
}

/** ⌘A / Ctrl+A without Shift/Alt — leave ⇧⌘A to app shortcuts. */
export function isNativeSelectAllEvent(event: KeyboardEvent): boolean {
	if (event.defaultPrevented) return false;
	if (!(event.metaKey || event.ctrlKey)) return false;
	if (event.shiftKey || event.altKey) return false;
	return event.key.toLowerCase() === "a";
}
