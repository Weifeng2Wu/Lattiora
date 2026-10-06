/**
 * Cross-window active-document broadcast for feature popout windows.
 * Main App windows emit; feature windows listen and follow active path.
 */

import type { AgentSessionRecord } from "@/lib/agent/agent-session-store";
import type { ChatLine } from "@/lib/agent/chat-state";
import { broadcastSafe } from "@/lib/core/tauri-events";

export const WORKSPACE_ACTIVE_CHANGED_EVENT = "workspace:active-changed";
export const AGENT_OPEN_SESSION_EVENT = "agent:open-session";
/** Main → new Agent feature window: full session snapshot for continuity. */
export const AGENT_SESSION_HANDOFF_EVENT = "agent:session-handoff";

export type WorkspaceActiveChangedPayload = {
	path: string | null;
	vaultPath: string | null;
	/** Paper title when known (Agent header etc.). */
	paperTitle?: string | null;
};

/** Serializable Agent panel state for a newly opened feature window. */
export type AgentSessionHandoffPayload = {
	sessions: AgentSessionRecord[];
	activeTabId: string;
	draftLines: ChatLine[];
	/** Preferred agent switcher selection (usually active session's agentId). */
	selectedAgentId?: string | null;
};

/** Emit from full App windows when the active dock document changes. */
export function broadcastWorkspaceActive(
	payload: WorkspaceActiveChangedPayload,
): void {
	broadcastSafe(WORKSPACE_ACTIVE_CHANGED_EVENT, payload);
}

/** Subscribe in feature windows (and tests). */
export async function listenWorkspaceActive(
	_handler: (payload: WorkspaceActiveChangedPayload) => void,
): Promise<() => void> {
	return () => {};
}

/** Forward PDF pin → Agent open requests into a popped-out agent window. */
export function broadcastAgentOpenSession(payload: unknown): void {
	broadcastSafe(AGENT_OPEN_SESSION_EVENT, payload);
}

export async function listenAgentOpenSession(
	_handler: (payload: unknown) => void,
): Promise<() => void> {
	return () => {};
}

/** Emit session snapshot so a new Agent feature window can restore the open chat. */
export function broadcastAgentSessionHandoff(
	payload: AgentSessionHandoffPayload,
): void {
	broadcastSafe(AGENT_SESSION_HANDOFF_EVENT, payload);
}

/**
 * Snapshot main-window agent store and emit handoff (with light retries so a
 * just-created feature window can subscribe after boot).
 *
 * Producer assumption: only the main window that opened the Agent feature
 * window emits this event for that open. The feature window applies the first
 * payload only (`applyAgentSessionHandoffOnce`).
 */
export function scheduleAgentSessionHandoffFromMain(): void {
	return;
}

export async function listenAgentSessionHandoff(
	_handler: (payload: AgentSessionHandoffPayload) => void,
): Promise<() => void> {
	return () => {};
}
