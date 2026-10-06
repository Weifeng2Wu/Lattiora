/**
 * IME (Input Method Editor) helpers for CJK / other composition input.
 *
 * Classic bug: during composition, Enter confirms a candidate. Some engines
 * fire `compositionend` *before* the confirming `keydown`, so React state
 * `isComposing` and even `event.nativeEvent.isComposing` may already be false
 * when the handler runs — and Enter accidentally submits the form.
 *
 * Name: "IME composition race" / "Enter during composition" / keyCode 229.
 */

/** Legacy DOM keyCode while the IME is processing a keystroke. */
export const IME_KEY_CODE = 229;

type KeyLike = {
	isComposing?: boolean;
	keyCode?: number;
	which?: number;
	nativeEvent?: {
		isComposing?: boolean;
		keyCode?: number;
		which?: number;
	};
};

/**
 * True when this keyboard event is part of IME composition (or still
 * attributed to the IME via legacy keyCode 229).
 */
export function isImeKeyboardEvent(event: KeyLike): boolean {
	if (event.isComposing || event.nativeEvent?.isComposing) {
		return true;
	}
	const code =
		event.keyCode ??
		event.which ??
		event.nativeEvent?.keyCode ??
		event.nativeEvent?.which;
	return code === IME_KEY_CODE;
}

/**
 * Grace window after `compositionend` so the confirming Enter (which often
 * arrives on the next tick with `isComposing === false`) does not trigger
 * submit / menu select. ~100ms covers macOS Safari/Chrome + common IMEs.
 */
export const IME_COMPOSITION_END_GRACE_MS = 100;
