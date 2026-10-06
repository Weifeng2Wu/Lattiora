/**
 * Bind PDF text-selection ask cards for an accepted Agent turn: each
 * geometry-anchored selection becomes one ask conversation card pin, and the
 * writes are registered as pending so complete/fail patches the assistant
 * reply. Best-effort: a failed ask-card write never stops the chat run.
 */
import {
	type SelectionContext,
	selectionsWithPdfAnchor,
} from "@/lib/agent/selection-store";
import {
	createAskThreadFromAgentSelection,
	writePdfAskThread,
} from "@/lib/pdf/ask/io";
import { rememberPendingAskThreads } from "@/lib/pdf/ask/pending";

export type BindAskThreadsInput = {
	runtimeSessionId: string;
	/** Turn text; empty or ACP-command turns create no ask cards. */
	userText: string;
	selections: SelectionContext[];
	isAcpCommand: boolean;
};

export async function bindAskThreadsForTurn({
	runtimeSessionId,
	userText,
	selections,
	isAcpCommand,
}: BindAskThreadsInput): Promise<void> {
	// PDF text selections with geometry → ask conversation cards (kind ask),
	// not visual-annotation agent-trace marks. One card pin per selection.
	const anchoredSelections =
		!isAcpCommand && userText ? selectionsWithPdfAnchor(selections) : [];
	if (!anchoredSelections.length) return;

	const pendingAskWrites: Array<{
		paperAbsPath: string;
		threadId: string;
	}> = [];
	const userContent = userText.trim();
	for (const sel of anchoredSelections) {
		try {
			const thread = createAskThreadFromAgentSelection({
				paperPath: sel.sourcePath || sel.paperAbsPath,
				page: sel.page,
				rects: sel.rects,
				quote: sel.text,
				userContent,
				agentSessionId: runtimeSessionId,
			});
			await writePdfAskThread(sel.paperAbsPath, thread);
			pendingAskWrites.push({
				paperAbsPath: sel.paperAbsPath,
				threadId: thread.id,
			});
		} catch {
			// Keep chat running even if ask-card write fails.
		}
	}
	rememberPendingAskThreads(runtimeSessionId, pendingAskWrites);
}
