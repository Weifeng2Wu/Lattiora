/**
 * Shared run/listen core for the PDF viewer's ask + translate clusters: one
 * `runOnce` acceptance plus the three ACP listeners (stream / completed /
 * failed) that used to be copy-pasted across `use-pdf-ask-threads` and
 * `use-pdf-selection-translate`.
 *
 * Session bookkeeping follows the translate cluster's (stricter) semantics:
 * each cluster tracks its own session token (`sessionRef`), and the shared
 * single-run slot (`activeSessionRef`) is only cleared while it still holds
 * that same token — so one cluster's stop/teardown can never cancel or
 * unseat the other cluster's in-flight run.
 */

import type { RefObject } from "react";
import {
	type AgentFailedEvent,
	type AgentResultPayload,
	type AgentStreamEvent,
	cancelAgentRun,
	listenAgentCompleted,
	listenAgentFailed,
	listenAgentStream,
	type RunOnceAccepted,
} from "@/lib/agent/api";
import type { UnlistenFn } from "@/lib/core/browser-events";

export type AgentRunRefs = {
	/** True once the owning viewer unmounted; guards late-accepted runs. */
	disposedRef: RefObject<boolean>;
	/** IPC unlisteners of the in-flight run (null when idle). */
	unsubsRef: RefObject<UnlistenFn[] | null>;
	/** The cluster's own token for the in-flight run. */
	sessionRef: RefObject<string | null>;
	/** Viewer-wide single-run slot shared by the ask + translate clusters. */
	activeSessionRef: RefObject<string | null>;
};

export type AttachAgentRunOptions = AgentRunRefs & {
	accepted: RunOnceAccepted;
	/** Runs once the session refs are armed, before the listeners attach. */
	onArmed?: (sessionId: string) => void;
	/** Message chunk; foreign sessions and thought chunks are filtered out. */
	onStream: (ev: AgentStreamEvent) => void;
	/** Terminal success; the listeners are detached right after. */
	onCompleted: (ev: AgentResultPayload) => void;
	/** Terminal failure; the listeners are detached right after. */
	onFailed: (ev: AgentFailedEvent) => void;
	/** Called when the run stops streaming (terminal event or late dispose). */
	onSettled?: () => void;
};

/**
 * Arm the session refs and attach the stream / completed / failed listeners
 * for one accepted run. A run accepted after the viewer unmounted is
 * cancelled and dropped. Listener registration errors propagate to the
 * caller's try/catch.
 */
export async function attachAgentRun({
	accepted,
	disposedRef,
	unsubsRef,
	sessionRef,
	activeSessionRef,
	onArmed,
	onStream,
	onCompleted,
	onFailed,
	onSettled,
}: AttachAgentRunOptions): Promise<void> {
	const sessionId = accepted.sessionId;
	if (disposedRef.current) {
		// Viewer unmounted while the run was being accepted: drop it.
		void cancelAgentRun(sessionId).catch(() => undefined);
		return;
	}
	sessionRef.current = sessionId;
	activeSessionRef.current = sessionId;
	onArmed?.(sessionId);
	const unsubs: UnlistenFn[] = [];
	unsubsRef.current = unsubs;
	const cleanup = () => {
		for (const u of unsubs) u();
		if (unsubsRef.current === unsubs) unsubsRef.current = null;
		if (sessionRef.current === sessionId) sessionRef.current = null;
		if (activeSessionRef.current === sessionId) activeSessionRef.current = null;
		onSettled?.();
	};
	unsubs.push(
		await listenAgentStream((ev) => {
			if (ev.sessionId !== sessionId) return;
			if ((ev.kind ?? "message") === "thought") return;
			onStream(ev);
		}),
	);
	unsubs.push(
		await listenAgentCompleted((ev) => {
			if (ev.sessionId !== sessionId) return;
			onCompleted(ev);
			cleanup();
		}),
	);
	unsubs.push(
		await listenAgentFailed((ev) => {
			if (ev.sessionId !== sessionId) return;
			onFailed(ev);
			cleanup();
		}),
	);
	if (disposedRef.current) {
		// Viewer unmounted while the listeners were being attached.
		cleanup();
	}
}

/**
 * Viewer-teardown half of {@link attachAgentRun}: detach the in-flight run's
 * listeners and cancel the run itself. Terminal events never arrive for a
 * hung run, so teardown cannot rely on the completed/failed handlers alone.
 */
export function disposeAgentRun({
	disposedRef,
	unsubsRef,
	sessionRef,
	activeSessionRef,
}: AgentRunRefs): void {
	disposedRef.current = true;
	const unsubs = unsubsRef.current;
	unsubsRef.current = null;
	if (unsubs) for (const u of unsubs) u();
	const sid = sessionRef.current;
	if (sid) {
		sessionRef.current = null;
		if (activeSessionRef.current === sid) activeSessionRef.current = null;
		void cancelAgentRun(sid).catch(() => undefined);
	}
}
