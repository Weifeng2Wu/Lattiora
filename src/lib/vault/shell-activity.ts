/**
 * Shell foreground activity for Vault watcher consumers.
 *
 * Hidden or blurred windows should avoid kicking off tree / wiki / editor
 * refresh work; wakeups resume when the webview is visible and focused again.
 */

export function isShellActive(): boolean {
	if (typeof document === "undefined") return true;
	if (document.visibilityState === "hidden") return false;
	if (typeof document.hasFocus === "function" && !document.hasFocus()) {
		return false;
	}
	return true;
}

/** Subscribe to visibility / focus transitions. Fires immediately with the current state. */
export function subscribeShellActivity(
	onChange: (active: boolean) => void,
): () => void {
	if (typeof window === "undefined" || typeof document === "undefined") {
		onChange(true);
		return () => undefined;
	}

	let prev = isShellActive();
	const fire = () => {
		const next = isShellActive();
		if (next === prev) return;
		prev = next;
		onChange(next);
	};

	document.addEventListener("visibilitychange", fire);
	window.addEventListener("focus", fire);
	window.addEventListener("blur", fire);
	onChange(prev);

	return () => {
		document.removeEventListener("visibilitychange", fire);
		window.removeEventListener("focus", fire);
		window.removeEventListener("blur", fire);
	};
}

/** Debounce delay for watcher-driven UI refresh while the shell is foregrounded. */
export const WATCH_REFRESH_ACTIVE_MS = {
	tree: 400,
	wiki: 900,
	library: 500,
} as const;

/** Longer coalesce window while the shell is backgrounded / unfocused. */
export const WATCH_REFRESH_BACKGROUND_MS = {
	tree: 2500,
	wiki: 3000,
	library: 2500,
} as const;

export function watchRefreshDelayMs(
	kind: keyof typeof WATCH_REFRESH_ACTIVE_MS,
): number {
	const table = isShellActive()
		? WATCH_REFRESH_ACTIVE_MS
		: WATCH_REFRESH_BACKGROUND_MS;
	return table[kind];
}
