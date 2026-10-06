/**
 * Cross-component Agent context attach (file tree → Agent chat).
 *
 * Right-click "Add to chat" in the file tree must drop a file into the Agent
 * composer as a removable context chip, no matter where the panel lives (right
 * rail or the singleton feature window). Like composer-seed, this is a
 * module-level pub/sub for same-window consumers plus a Tauri event for the
 * cross-window popout.
 */

import { broadcastSafe } from "@/lib/core/tauri-events";

export const AGENT_ATTACH_CONTEXT_EVENT = "agent:attach-context";

export type AgentAttachContextPayload = {
	/** Absolute (or vault-relative) paths; Agent converts to vault-relative. */
	paths: string[];
};

type Listener = (paths: string[]) => void;

/** Main-window only: pending paths until an Agent panel consumes them. */
let pendingPaths: string[] | null = null;
const listeners = new Set<Listener>();

/** File tree (same window): stash paths for the mounted Agent panel. */
export function setPendingAgentContextPaths(paths: string[]): void {
	const normalized = paths.filter(Boolean);
	if (!normalized.length) return;
	pendingPaths = normalized;
	for (const listener of listeners) {
		listener(normalized);
	}
}

/** Agent panel: take and clear one pending attach (or null). */
export function takePendingAgentContextPaths(): string[] | null {
	const next = pendingPaths;
	pendingPaths = null;
	return next;
}

export function subscribePendingAgentContextPaths(
	listener: Listener,
): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Any window: ask the Agent panel (wherever it is) to attach these paths. */
export function broadcastAgentAttachContext(paths: string[]): void {
	const normalized = paths.filter(Boolean);
	if (!normalized.length) return;
	setPendingAgentContextPaths(normalized);
	broadcastSafe(AGENT_ATTACH_CONTEXT_EVENT, {
		paths: normalized,
	} satisfies AgentAttachContextPayload);
}

export async function listenAgentAttachContext(
	_handler: (paths: string[]) => void,
): Promise<() => void> {
	return () => {};
}
