/**
 * In-memory map from Agent runtime session id → traces awaiting completion.
 * Used so complete/fail handlers can patch answerSnapshot / providerSessionId.
 *
 * Lifecycle:
 * - remember on successful send (after marks are written)
 * - take on complete / fail / cancel
 * - prune orphans by age / max size so long-lived app sessions cannot leak
 * - after take, keep a short grace window so concurrent list+reconcile does not
 *   mark a just-finalizing pin as "interrupted"
 */

import { createPendingSessionRegistry } from "@/lib/core/pending-session-registry";

export type PendingVisualTraceWrite = {
	paperAbsPath: string;
	traceId: string;
};

const visualTracePending =
	createPendingSessionRegistry<PendingVisualTraceWrite>({
		/** Long Agent runs still re-touch via remember merge. */
		ttlMs: 60 * 60 * 1000, // 1h
		maxSessions: 64,
		/** Reconcile-race shield: see lifecycle note above. */
		graceMs: 30_000,
	});

export function rememberPendingVisualTraces(
	runtimeSessionId: string,
	writes: PendingVisualTraceWrite[],
): void {
	visualTracePending.remember(runtimeSessionId, writes);
}

export function takePendingVisualTraces(
	runtimeSessionId: string,
): PendingVisualTraceWrite[] {
	return visualTracePending.take(runtimeSessionId);
}

/** True while a runtime session still owns pending mark finalizers (or just took them). */
export function isVisualTraceSessionPending(runtimeSessionId: string): boolean {
	return visualTracePending.isPending(runtimeSessionId);
}

/** Test helper — clear maps between unit cases. */
export function resetPendingVisualTracesForTests(): void {
	visualTracePending.resetForTests();
}
