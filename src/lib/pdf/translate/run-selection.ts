/**
 * Container-agnostic engine for one selection-translate run: resolve the
 * configured provider, then either stream an ACP Agent turn
 * (`runOnce({workflow: "translate"})` + `attachAgentRun`) or await a plain
 * translate provider.
 *
 * The owning hook adapts its record container (the persisted `translates`
 * array in `usePdfSelectionTranslate`, the single ephemeral card in
 * `useWebViewSelection`) through the callbacks below. Prompt shape,
 * session-id cache get/set/evict timing, trim logic, callback order, and
 * failure cleanup match the former in-hook implementations exactly —
 * including the no-agent path leaving the streaming chrome alone (the
 * consumer's `markFailed` decides whether it stops).
 */

import type { AgentResultPayload } from "@/lib/agent";
import type { AgentRunRefs } from "@/lib/agent/run-attach";
import { errorText } from "@/lib/core/error";
import { notifyError } from "@/lib/core/notify";
import {
	displayTranslateError,
	prepareTranslateTask,
	runTranslate,
} from "@/lib/translate";
import type { TranslateTask } from "@/lib/translate/types";

export type RunSelectionTranslateOptions = AgentRunRefs & {
	/** Source text to translate. */
	text: string;
	/** Provenance shared by the task context and the agent prompt. */
	context: NonNullable<TranslateTask["context"]>;
	/** Session-cache key (paper path or web URL; null disables reuse). */
	paperKey: string | null;
	/** Vault root passed to the Agent run as its cwd. */
	vaultPath?: string | null;
	noAgentText: () => string;
	agentFailedText: () => string;
	/** Append one streamed chunk to the record. */
	appendChunk: (chunk: string) => void;
	/**
	 * Commit the final agent result (trim + record write + error chrome
	 * clear). Return false when the record is no longer current — that also
	 * skips the session-id cache write.
	 */
	commitAgentResult: (ev: AgentResultPayload) => boolean;
	/**
	 * Commit a plain-provider result (already trimmed), including the
	 * streaming-chrome stop — the consumer may guard record staleness.
	 */
	commitProviderResult: (result: string) => void;
	/** Mark the record failed; the consumer owns record/error chrome updates. */
	markFailed: (message: string) => void;
	/** Stop the streaming chrome (agent settle + both catch paths). */
	stopStreaming: () => void;
};

/**
 * Run one selection translate: branch on the configured provider, stream the
 * Agent turn into the consumer's record, or await the plain provider.
 * Listener-registration errors land in the catch path (streaming stopped,
 * failure marked). Returns when the synchronous dispatch is handed off
 * (agent runs keep streaming through the ACP listeners).
 */
export async function runSelectionTranslate({
	text,
	context,
	commitProviderResult,
	markFailed,
	stopStreaming,
}: RunSelectionTranslateOptions): Promise<void> {
	const { providerId } = prepareTranslateTask({
		text,
		context,
	});

	try {
		const result = await runTranslate({ text, context }, { providerId });
		commitProviderResult(result.trim());
	} catch (e) {
		const message = displayTranslateError(errorText(e));
		notifyError(message);
		markFailed(message);
		stopStreaming();
	}
}
