/**
 * In-memory map from Agent runtime session id → ask threads awaiting the
 * assistant turn (PDF selection → Agent chat → conversation card).
 *
 * Same lifecycle idea as agent-trace pending: remember on send, take on
 * complete/fail, TTL so long-lived sessions cannot leak. No grace window —
 * ask has no list+reconcile race to shield.
 */

import { createPendingSessionRegistry } from "@/lib/core/pending-session-registry";

export type PendingAskThreadWrite = {
	paperAbsPath: string;
	threadId: string;
};

const askThreadPending = createPendingSessionRegistry<PendingAskThreadWrite>({
	ttlMs: 60 * 60 * 1000,
	maxSessions: 64,
});

export function rememberPendingAskThreads(
	runtimeSessionId: string,
	writes: PendingAskThreadWrite[],
): void {
	askThreadPending.remember(runtimeSessionId, writes);
}

export function takePendingAskThreads(
	runtimeSessionId: string,
): PendingAskThreadWrite[] {
	return askThreadPending.take(runtimeSessionId);
}

/** Test helper — clear maps between unit cases. */
export function resetPendingAskThreadsForTests(): void {
	askThreadPending.resetForTests();
}
