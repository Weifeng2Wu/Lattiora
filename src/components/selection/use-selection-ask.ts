/**
 * Shared lifecycle of an ephemeral selection Ask (quick chat) thread.
 *
 * Lifted from the Plaza feed selection hook so any text surface (plaza detail,
 * proxied web papers, …) gets the same run machinery: in-memory `PdfAskThread`
 * (nothing writes marks/), turn engine from `@/lib/pdf/ask/run-turn`, and IPC
 * teardown. Surfaces keep their own selection capture and pass a `buildPrompt`
 * that stamps their context (title / URL / surface wording).
 */

import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { disposeAgentRun } from "@/lib/agent";
import type { UnlistenFn } from "@/lib/core/browser-events";
import { createEmptyThread } from "@/lib/pdf/ask";
import {
	dispatchAskTurn,
	type ResolvedAskAgent,
	resendBaseMessages,
	resolveAskAgent,
	runAskTurn,
	stopAskRun,
} from "@/lib/pdf/ask/run-turn";
import type { PdfAskThread } from "@/lib/pdf/ask/types";
import { getVaultPath } from "@/lib/vault/store";

export type SelectionAskState<S> = {
	thread: PdfAskThread;
	/** Surface-specific placement info for the ask card. */
	screen: S;
};

/** Open an ephemeral ask thread anchored at a selection quote. */
export function createSelectionAskThread(
	sourcePath: string,
	quote: string,
): PdfAskThread {
	return createEmptyThread({
		paperPath: sourcePath,
		anchor: { page: 1, rects: [], quote, trigger: "selection" },
	});
}

export function useSelectionAsk<S>({
	buildPrompt,
	activeSessionRef,
}: {
	/** Surface context (title / URL / wording) stamped around the thread. */
	buildPrompt: (thread: PdfAskThread, latestUserQuestion: string) => string;
	/**
	 * Single in-flight agent run per surface, shared with the translate
	 * cluster; parent-owned so either can cancel the other's session token.
	 */
	activeSessionRef: RefObject<string | null>;
}) {
	const { t } = useTranslation("viewer");
	const [ask, setAsk] = useState<SelectionAskState<S> | null>(null);
	const [streaming, setStreaming] = useState(false);
	const [askError, setAskError] = useState<string | null>(null);

	const askRef = useRef<SelectionAskState<S> | null>(null);
	askRef.current = ask;

	const runDisposedRef = useRef(false);
	const runUnsubsRef = useRef<UnlistenFn[] | null>(null);
	const askSessionRef = useRef<string | null>(null);

	useEffect(() => {
		runDisposedRef.current = false;
		return () => {
			disposeAgentRun({
				disposedRef: runDisposedRef,
				unsubsRef: runUnsubsRef,
				sessionRef: askSessionRef,
				activeSessionRef,
			});
		};
	}, [activeSessionRef]);

	/** Drop the ask chrome without cancelling (surface navigation reset). */
	const resetAsk = useCallback(() => {
		setAsk(null);
		setAskError(null);
		setStreaming(false);
	}, []);

	const upsertAskThread = useCallback((thread: PdfAskThread) => {
		setAsk((prev) => (prev ? { ...prev, thread } : prev));
	}, []);

	const patchAskThread = useCallback(
		(
			threadId: string,
			transform: (thread: PdfAskThread) => PdfAskThread,
			onApplied?: (thread: PdfAskThread) => void,
		) => {
			setAsk((prev) => {
				if (!prev || prev.thread.id !== threadId) return prev;
				const thread = transform(prev.thread);
				if (thread === prev.thread) return prev;
				onApplied?.(thread);
				return { ...prev, thread };
			});
		},
		[],
	);

	const sendToThread = useCallback(
		async (
			thread: PdfAskThread,
			question: string,
			agentOpts?: { agentId?: string; modelId?: string },
			baseMessages?: PdfAskThread["messages"],
		) =>
			runAskTurn({
				thread,
				question,
				agent: agentOpts,
				baseMessages,
				vaultPath: getVaultPath() ?? undefined,
				buildPrompt,
				upsertThread: upsertAskThread,
				patchThread: patchAskThread,
				setAskError,
				setStreaming,
				failureText: () => t("pdfAsk.agentFailed"),
				disposedRef: runDisposedRef,
				unsubsRef: runUnsubsRef,
				sessionRef: askSessionRef,
				activeSessionRef,
			}),
		[buildPrompt, upsertAskThread, patchAskThread, activeSessionRef, t],
	);

	const resolveAgent = useCallback(
		async (): Promise<ResolvedAskAgent | null> =>
			resolveAskAgent(() => t("pdfAsk.noAgent"), setAskError),
		[t],
	);

	const sendAskQuestion = useCallback(
		(question: string) => {
			const current = askRef.current;
			if (!current) return;
			dispatchAskTurn({
				thread: current.thread,
				question,
				resolveAgent,
				run: sendToThread,
				onError: setAskError,
			});
		},
		[resolveAgent, sendToThread],
	);

	const resendAskQuestion = useCallback(
		(messageId: string, question: string) => {
			const current = askRef.current;
			if (!current) return;
			const baseMessages = resendBaseMessages(
				current.thread.messages,
				messageId,
			);
			if (!baseMessages) return;
			dispatchAskTurn({
				thread: current.thread,
				question,
				baseMessages,
				resolveAgent,
				run: sendToThread,
				onError: setAskError,
			});
		},
		[resolveAgent, sendToThread],
	);

	const stopAskStreaming = useCallback(() => {
		stopAskRun(askSessionRef, activeSessionRef, () => setStreaming(false));
	}, [activeSessionRef]);

	const hideAsk = useCallback(() => {
		stopAskStreaming();
		setAsk(null);
		setAskError(null);
	}, [stopAskStreaming]);

	const deleteAsk = useCallback(() => {
		stopAskStreaming();
		setAsk(null);
		setAskError(null);
	}, [stopAskStreaming]);

	return {
		ask,
		setAsk,
		streaming,
		askError,
		setAskError,
		resetAsk,
		sendAskQuestion,
		resendAskQuestion,
		hideAsk,
		deleteAsk,
		stopAskStreaming,
	};
}
