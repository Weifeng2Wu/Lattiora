export type MarkdownSaveSettlement = {
	/** Last Markdown version confirmed to be on disk. */
	savedMarkdown: string;
	/** Whether the editor still differs from the confirmed disk version. */
	dirty: boolean;
	/** Save the latest editor value after the current successful write. */
	retryLatest: boolean;
};

/**
 * Reconcile one asynchronous Markdown save attempt.
 *
 * Failed/conflicted writes never advance the confirmed snapshot. If the user
 * edits while a write is in flight, the successful attempt becomes the new
 * base and the latest value is queued for a second save.
 */
export function settleMarkdownSaveAttempt({
	attemptedMarkdown,
	currentMarkdown,
	lastSaved,
	persisted,
}: {
	attemptedMarkdown: string;
	currentMarkdown: string;
	lastSaved: string;
	persisted: boolean;
}): MarkdownSaveSettlement {
	if (!persisted) {
		return {
			savedMarkdown: lastSaved,
			dirty: currentMarkdown !== lastSaved,
			retryLatest: false,
		};
	}
	return {
		savedMarkdown: attemptedMarkdown,
		dirty: currentMarkdown !== attemptedMarkdown,
		retryLatest: currentMarkdown !== attemptedMarkdown,
	};
}
