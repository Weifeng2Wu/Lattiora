import { useEffect, useRef, useSyncExternalStore } from "react";

import {
	isAnyModalOverlayOpen,
	pushOverlay,
	subscribeOverlayStack,
} from "@/lib/core/overlay-stack";

/**
 * While `open` is true, register this overlay on the app stack so
 * Esc / ⌘W can dismiss it via {@link closeTopOverlay}.
 *
 * @param options.modal - When true (default), this overlay blocks global
 *   shortcuts that declare `whenSettingsClosed: true`. Set to false for
 *   docked surfaces that should remain dismissable with Esc but not steal
 *   shortcut focus.
 */
export function useOverlayRegistration(
	id: string,
	open: boolean,
	close: () => void,
	options?: { modal?: boolean },
): void {
	const modal = options?.modal ?? true;
	const closeRef = useRef(close);
	closeRef.current = close;

	useEffect(() => {
		if (!open) return;
		return pushOverlay({
			id,
			modal,
			close: () => {
				closeRef.current();
			},
		});
	}, [id, open, modal]);
}

/**
 * True when any *modal* registered overlay is open — used to gate
 * workspace shortcuts. Non-modal surfaces (agent ask/permission cards)
 * don't count, so the workspace stays operable while they are shown.
 */
export function useAnyModalOverlayOpen(): boolean {
	return useSyncExternalStore(
		subscribeOverlayStack,
		isAnyModalOverlayOpen,
		() => false,
	);
}
