/**
 * Bind disk finalizers for an accepted Agent turn's runtime session:
 * - first turn with visual drafts → create one mark file per crop
 * - follow-up on a bound pin (no new drafts) → continue the existing mark
 * In both cases re-register pending writes so complete/fail patches the mark.
 * Best-effort: a failed mark write never stops the chat run.
 */
import type { PdfVisualDraft } from "@/lib/agent/visual-context-store";
import { joinPath } from "@/lib/core/path";
import {
	beginTraceContinue,
	createRunningTraces,
	readPdfVisualTrace,
	writePdfVisualTrace,
} from "@/lib/pdf/agent-trace/io";
import { rememberPendingVisualTraces } from "@/lib/pdf/agent-trace/pending";
import { newTraceMessageId } from "@/lib/pdf-visual/ids";

export type BindVisualTracesInput = {
	runtimeSessionId: string;
	messageId: string;
	agentId: string;
	vaultPath: string | null;
	/** Turn text used as the first user message on newly created marks. */
	userText: string;
	visualDrafts: PdfVisualDraft[];
	/** Set on a follow-up that continues an existing mark (no new drafts). */
	continueVisualTraceId?: string;
	continuePaperAbs?: string;
};

export async function bindVisualTracesForTurn({
	runtimeSessionId,
	messageId,
	agentId,
	vaultPath,
	userText,
	visualDrafts,
	continueVisualTraceId,
	continuePaperAbs,
}: BindVisualTracesInput): Promise<void> {
	if (visualDrafts.length > 0) {
		const byPaper = new Map<string, PdfVisualDraft[]>();
		for (const draft of visualDrafts) {
			const abs =
				draft.paperAbsPath?.trim() ||
				(vaultPath && draft.paperPath
					? joinPath(vaultPath, draft.paperPath)
					: draft.paperPath);
			if (!abs) continue;
			const list = byPaper.get(abs) ?? [];
			list.push(draft);
			byPaper.set(abs, list);
		}
		const pendingWrites: Array<{
			paperAbsPath: string;
			traceId: string;
		}> = [];
		for (const [paperAbsPath, drafts] of byPaper) {
			try {
				// One mark file per crop so pins hover/delete independently.
				// Prefer the turn text as the first user message (Cmd+Enter /
				// composer). draft.comment is the annotation note only — leave
				// it out of messages so wiki embeds do not show the same text twice.
				const text = userText.trim();
				const now = new Date().toISOString();
				const traces = createRunningTraces({
					paperPath: drafts[0]?.paperPath || paperAbsPath,
					agentId,
					runtimeSessionId,
					messageId,
					items: drafts.map((draft) => ({
						id: draft.id,
						page: draft.page,
						rects: draft.rects,
						comment: draft.comment,
						image: {
							data: draft.image.data,
							mimeType: draft.image.mimeType || "image/png",
						},
						messages: text
							? [
									{
										id: newTraceMessageId(),
										role: "user" as const,
										content: text,
										createdAt: now,
									},
								]
							: undefined,
					})),
					createdAt: now,
				});
				for (const trace of traces) {
					await writePdfVisualTrace(paperAbsPath, trace);
					pendingWrites.push({ paperAbsPath, traceId: trace.id });
				}
			} catch {
				// Keep chat running even if mark write fails.
			}
		}
		rememberPendingVisualTraces(runtimeSessionId, pendingWrites);
		return;
	}

	if (continueVisualTraceId && continuePaperAbs) {
		try {
			const current = await readPdfVisualTrace(
				continuePaperAbs,
				continueVisualTraceId,
			);
			if (current) {
				const next = beginTraceContinue(current, {
					runtimeSessionId,
					messageId,
					userContent: userText,
					// Note-only marks need agentId when attaching the first thread.
					agentId: agentId || current.agent?.agentId || undefined,
				});
				await writePdfVisualTrace(continuePaperAbs, next);
			}
		} catch {
			// Keep chat running even if mark write fails.
		}
		rememberPendingVisualTraces(runtimeSessionId, [
			{
				paperAbsPath: continuePaperAbs,
				traceId: continueVisualTraceId,
			},
		]);
	}
}
