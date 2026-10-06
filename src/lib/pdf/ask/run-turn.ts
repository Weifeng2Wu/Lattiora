/** Shared streamed Cloudflare question runner for the original selection cards.
 * PDF cards persist checkpoints; transient Markdown selection cards stay ephemeral. */

import type { RefObject } from "react";
import type { PromptImage } from "@/lib/agent";
import type { AgentRunRefs } from "@/lib/agent/run-attach";
import { cloudAiError, ocrCloudImage, streamChat } from "@/lib/cloud/ai";
import { errorText } from "@/lib/core/error";
import { notifyError } from "@/lib/core/notify";
import { newMessageId } from "@/lib/pdf/ask/io";
import type { PdfAskMessage, PdfAskThread } from "@/lib/pdf/ask/types";
import type { resolveTranslateAgent } from "@/lib/translate";

const cloudAskControllers = new Map<string, AbortController>();

export type ResolvedAskAgent = Awaited<
	ReturnType<typeof resolveTranslateAgent>
>;

/**
 * Resolve the configured PDF-ask agent (default seat + model). A missing
 * agent notifies and reports through the ask error chrome.
 */
export async function resolveAskAgent(
	_noAgentText: () => string,
	_onError: (message: string) => void,
): Promise<ResolvedAskAgent | null> {
	return { agentId: "cloud", modelId: undefined };
}

/** Cancel the in-flight ask run (if any) and clear both session slots. */
export function cancelAskRun(
	sessionRef: RefObject<string | null>,
	activeSessionRef: RefObject<string | null>,
): void {
	const sid = sessionRef.current;
	if (!sid) return;
	sessionRef.current = null;
	if (activeSessionRef.current === sid) activeSessionRef.current = null;
	cloudAskControllers.get(sid)?.abort();
	cloudAskControllers.delete(sid);
}

/** Stop button: cancel + clear refs, then stop the streaming chrome. */
export function stopAskRun(
	sessionRef: RefObject<string | null>,
	activeSessionRef: RefObject<string | null>,
	onStopped: () => void,
): void {
	if (!sessionRef.current) return;
	cancelAskRun(sessionRef, activeSessionRef);
	onStopped();
}

/** Edit-a-user-turn base: messages before the edited one, or null when absent. */
export function resendBaseMessages(
	messages: PdfAskMessage[],
	messageId: string,
): PdfAskMessage[] | null {
	const index = messages.findIndex(
		(m) => m.id === messageId && m.role === "user",
	);
	if (index < 0) return null;
	return messages.slice(0, index);
}

export type DispatchAskTurnOptions = {
	thread: PdfAskThread;
	question: string;
	/** When set (edit/resend), the turn replaces the transcript from this base. */
	baseMessages?: PdfAskMessage[];
	resolveAgent: () => Promise<ResolvedAskAgent | null>;
	run: (
		thread: PdfAskThread,
		question: string,
		agent?: { agentId?: string; modelId?: string },
		baseMessages?: PdfAskMessage[],
	) => unknown;
	onError: (message: string) => void;
};

/** Resolve the ask agent, then fire one turn; resolve failures go to the ask error chrome. */
export function dispatchAskTurn({
	thread,
	question,
	baseMessages,
	resolveAgent,
	run,
	onError,
}: DispatchAskTurnOptions): void {
	void (async () => {
		try {
			const resolved = await resolveAgent();
			if (!resolved) return;
			void run(
				thread,
				question,
				{
					agentId: resolved.agentId,
					modelId: resolved.modelId,
				},
				baseMessages,
			);
		} catch (e) {
			const message = errorText(e);
			notifyError(message);
			onError(message);
		}
	})();
}

/**
 * Patch the live thread by id when the container still holds it. A transform
 * may return the same thread reference to signal no change.
 */
export type AskTurnPatch = (
	threadId: string,
	transform: (thread: PdfAskThread) => PdfAskThread,
	onApplied?: (thread: PdfAskThread) => void,
) => void;

export type RunAskTurnOptions = AgentRunRefs & {
	thread: PdfAskThread;
	question: string;
	agent?: { agentId?: string; modelId?: string };
	/** Replace-from base for resend (defaults to the full history). */
	baseMessages?: PdfAskMessage[];
	/** Visual PDF crops attached to this turn. */
	images?: PromptImage[];
	vaultPath?: string;
	buildPrompt: (thread: PdfAskThread, latestUserQuestion: string) => string;
	/** Merge the turn's thread snapshot into the owning container. */
	upsertThread: (thread: PdfAskThread) => void;
	patchThread: AskTurnPatch;
	/** Optional persistence of turn snapshots (terminal events included). */
	persist?: (thread: PdfAskThread) => void | Promise<void>;
	setAskError: (message: string | null) => void;
	setStreaming: (streaming: boolean) => void;
	failureText: () => string;
};

/**
 * Run one ask turn against a thread snapshot: append the optimistic user
 * message, accept the run, then stream / complete / fail the assistant reply
 * back into the container. Listener-registration errors land in the catch
 * path (streaming stopped, error surfaced).
 */
export async function runAskTurn({
	thread,
	question,
	baseMessages,
	images,
	buildPrompt,
	upsertThread,
	patchThread,
	persist,
	setAskError,
	setStreaming,
	disposedRef,
	unsubsRef,
	sessionRef,
	activeSessionRef,
}: RunAskTurnOptions): Promise<void> {
	const threadId = thread.id;
	if (!question.trim()) return;
	const userMsg = {
		id: newMessageId(),
		role: "user" as const,
		content: question,
		createdAt: new Date().toISOString(),
	};
	const prior = baseMessages ?? thread.messages;
	const withUser: PdfAskThread = {
		...thread,
		status: "open",
		messages: [...prior, userMsg],
		updatedAt: new Date().toISOString(),
	};
	upsertThread(withUser);
	let saves = Promise.resolve();
	const save = (snapshot: PdfAskThread) => {
		saves = saves
			.then(() => persist?.(snapshot))
			.catch((error) => {
				notifyError(cloudAiError(error));
			});
	};
	save(withUser);
	setAskError(null);
	setStreaming(true);

	const assistantId = newMessageId();
	const prompt = buildPrompt(withUser, question);
	const persistApplied = persist ? save : undefined;
	{
		const sid = `cloud-ask-${crypto.randomUUID()}`;
		const abort = new AbortController();
		cloudAskControllers.set(sid, abort);
		sessionRef.current = sid;
		activeSessionRef.current = sid;
		const cancel = () => abort.abort();
		unsubsRef.current = [cancel];
		let content = "";
		let snapshot: PdfAskThread = {
			...withUser,
			messages: [
				...withUser.messages,
				{
					id: assistantId,
					role: "assistant",
					content,
					createdAt: new Date().toISOString(),
					agentSessionId: sid,
				},
			],
		};
		upsertThread(snapshot);
		const patch = (persistNow = false) => {
			snapshot = {
				...snapshot,
				updatedAt: new Date().toISOString(),
				messages: snapshot.messages.map((m) =>
					m.id === assistantId ? { ...m, content } : m,
				),
			};
			if (disposedRef.current) {
				if (persistNow) save(snapshot);
				return;
			}
			patchThread(
				threadId,
				(th) => ({
					...th,
					updatedAt: new Date().toISOString(),
					messages: th.messages.map((m) =>
						m.id === assistantId ? { ...m, content } : m,
					),
				}),
				persistNow ? persistApplied : undefined,
			);
		};
		const checkpoint = persist
			? setInterval(() => patch(true), 1000)
			: undefined;
		try {
			const visualContext: string[] = [];
			for (const image of images ?? []) {
				visualContext.push(
					await ocrCloudImage(
						`data:${image.mimeType};base64,${image.data}`,
						"Describe this research-paper crop accurately. Transcribe formulas and readable text, and describe chart axes, legends and data without guessing missing values.",
						abort.signal,
					),
				);
			}
			await streamChat(
				[{ role: "user", content: prompt }],
				visualContext.join("\n\n"),
				(chunk) => {
					content += chunk;
					patch();
				},
				abort.signal,
			);
		} catch (error) {
			if (!abort.signal.aborted) {
				const message = cloudAiError(error);
				setAskError(message);
				notifyError(message);
			}
		} finally {
			clearInterval(checkpoint);
			patch(true);
			if (unsubsRef.current?.includes(cancel)) unsubsRef.current = null;
			cloudAskControllers.delete(sid);
			if (sessionRef.current === sid) sessionRef.current = null;
			if (activeSessionRef.current === sid) activeSessionRef.current = null;
			if (!disposedRef.current) setStreaming(false);
			await saves;
		}
		return;
	}
}
