/**
 * Surface-owned handlers for ⌘K Quick chat (in-page Ask) from a live selection.
 * PDF / Plaza register while mounted; App tries handlers newest-first until one
 * consumes the chord. Each handler returns false when it has no armed selection.
 */

type QuickChatHandler = () => boolean;

const handlers = new Set<QuickChatHandler>();

/** Register a surface Quick chat action; returns an unregister fn. */
export function registerSelectionQuickChat(next: QuickChatHandler): () => void {
	handlers.add(next);
	return () => {
		handlers.delete(next);
	};
}

/** Run registered Quick chat handlers (newest first) until one succeeds. */
export function runSelectionQuickChat(): boolean {
	const stack = [...handlers].reverse();
	for (const handler of stack) {
		if (handler()) return true;
	}
	return false;
}
