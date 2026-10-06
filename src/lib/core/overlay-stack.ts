/**
 * App-level modal / sheet stack.
 *
 * Popovers and tooltips stay local; full-screen sheets and Dialogs register
 * here so Esc / ⌘W and toggle shortcuts share one close path.
 */

export type OverlayHandle = {
	/** Stable id (e.g. "settings", "shortcuts"). Re-push moves to top. */
	id: string;
	/** Dismiss this overlay (idempotent). */
	close: () => void;
	/**
	 * When true, this overlay blocks global shortcuts that declare
	 * `whenSettingsClosed: true`. Docked surfaces (e.g. Agent ask-user form)
	 * should be non-modal so they do not steal shortcut focus.
	 */
	modal?: boolean;
};

type Listener = () => void;

const stack: OverlayHandle[] = [];
const listeners = new Set<Listener>();

function emit(): void {
	for (const l of listeners) l();
}

/** Subscribe to stack changes (React `useSyncExternalStore`). */
export function subscribeOverlayStack(onStoreChange: Listener): () => void {
	listeners.add(onStoreChange);
	return () => {
		listeners.delete(onStoreChange);
	};
}

export function getOverlayStackSnapshot(): readonly OverlayHandle[] {
	return stack;
}

export function isAnyOverlayOpen(): boolean {
	return stack.length > 0;
}

/** True when at least one registered overlay is modal (blocks global shortcuts). */
export function isAnyModalOverlayOpen(): boolean {
	return stack.some((h) => h.modal !== false);
}

/**
 * Register an open overlay at the top of the stack.
 * Call the returned disposer when the overlay closes or the owner unmounts.
 */
export function pushOverlay(handle: OverlayHandle): () => void {
	const normalized: OverlayHandle = {
		...handle,
		modal: handle.modal !== false,
	};
	const existing = stack.findIndex((h) => h.id === normalized.id);
	if (existing >= 0) stack.splice(existing, 1);
	stack.push(normalized);
	emit();
	return () => {
		const i = stack.findIndex((h) => h.id === normalized.id);
		if (i < 0) return;
		stack.splice(i, 1);
		emit();
	};
}

/** Close the topmost overlay. Returns true if something was closed. */
export function closeTopOverlay(): boolean {
	const top = stack.pop();
	if (!top) return false;
	emit();
	// Owner's open→false effect will also dispose; dispose is idempotent.
	top.close();
	return true;
}

/** Close a specific overlay by id if present. */
export function closeOverlayById(id: string): boolean {
	const i = stack.findIndex((h) => h.id === id);
	if (i < 0) return false;
	const [entry] = stack.splice(i, 1);
	emit();
	entry?.close();
	return true;
}
