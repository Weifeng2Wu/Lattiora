/**
 * Cross-window Agent composer seed (Settings → main).
 * Settings emits a Tauri event; main applies text into the open Agent composer.
 */

import { broadcastSafe } from "@/lib/core/tauri-events";

export const AGENT_OPEN_WITH_PROMPT_EVENT = "agent:open-with-prompt";

export type AgentOpenWithPromptPayload = {
	text: string;
};

type Listener = (text: string) => void;

/** Main-window only: pending prompt until Agent panel consumes it. */
let pendingPrompt: string | null = null;
const listeners = new Set<Listener>();

export function setPendingAgentComposerPrompt(text: string): void {
	const trimmed = text.trim();
	if (!trimmed) return;
	pendingPrompt = trimmed;
	for (const listener of listeners) {
		listener(trimmed);
	}
}

/** Agent panel: take and clear one pending seed (or null). */
export function takePendingAgentComposerPrompt(): string | null {
	const next = pendingPrompt;
	pendingPrompt = null;
	return next;
}

export function subscribePendingAgentComposerPrompt(
	listener: Listener,
): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Settings (or any window): ask main to open Agent with this prompt. */
export function broadcastOpenAgentWithPrompt(text: string): void {
	const trimmed = text.trim();
	if (!trimmed) return;
	broadcastSafe(AGENT_OPEN_WITH_PROMPT_EVENT, {
		text: trimmed,
	} satisfies AgentOpenWithPromptPayload);
}

export async function listenOpenAgentWithPrompt(
	_handler: (payload: AgentOpenWithPromptPayload) => void,
): Promise<() => void> {
	return () => {};
}
