import { beforeEach, describe, expect, it, vi } from "vitest";

import { createEmptyThread } from "@/lib/pdf/ask";
import {
	type AskTurnPatch,
	resendBaseMessages,
	runAskTurn,
	stopAskRun,
} from "@/lib/pdf/ask/run-turn";
import type { PdfAskThread } from "@/lib/pdf/ask/types";

const stream = vi.hoisted(() => vi.fn());
vi.mock("@/lib/cloud/ai", () => ({
	streamChat: stream,
	ocrCloudImage: vi.fn(),
	cloudAiError: (e: Error) => e.message,
}));
vi.mock("@/lib/core/notify", () => ({ notifyError: vi.fn() }));
/** In-memory container double: one live thread per id, like the hook adapters. */
function container() {
	const threads = new Map<string, PdfAskThread>();
	const persisted: PdfAskThread[] = [];
	const upsertThread = (thread: PdfAskThread) => {
		threads.set(thread.id, thread);
	};
	const patchThread: AskTurnPatch = (threadId, transform, onApplied) => {
		const prev = threads.get(threadId);
		if (!prev) return;
		const done = transform(prev);
		if (done === prev) return;
		onApplied?.(done);
		threads.set(threadId, done);
	};
	return {
		threads,
		persisted,
		upsertThread,
		patchThread,
		persist: (thread: PdfAskThread) => {
			persisted.push(thread);
		},
	};
}

function fixture(): PdfAskThread {
	return createEmptyThread({
		paperPath: "papers/x",
		anchor: {
			page: 1,
			rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }],
			trigger: "selection",
		},
	});
}

function runOptions(c: ReturnType<typeof container>) {
	const errors: (string | null)[] = [];
	const streaming: boolean[] = [];
	return {
		errors,
		streaming,
		options: {
			buildPrompt: (thread: PdfAskThread, question: string) =>
				`P:${thread.id}:${question}`,
			upsertThread: c.upsertThread,
			patchThread: c.patchThread,
			persist: c.persist,
			setAskError: (message: string | null) => errors.push(message),
			setStreaming: (value: boolean) => streaming.push(value),
			failureText: () => "agent failed",
			disposedRef: { current: false },
			unsubsRef: { current: null as Array<() => void> | null },
			sessionRef: { current: null },
			activeSessionRef: { current: null },
		},
	};
}

describe("cloud PDF selection questions", () => {
	beforeEach(() => {
		stream.mockReset();
	});
	it("persists a completed streamed answer", async () => {
		const c = container(),
			{ options, streaming, errors } = runOptions(c),
			thread = fixture();
		stream.mockImplementation(async (_messages, _context, delta) => {
			delta("first ");
			delta("answer");
			return "first answer";
		});
		await runAskTurn({ ...options, thread, question: "Why?" });
		expect(c.persisted.at(-1)?.messages.map((m) => m.content)).toEqual([
			"Why?",
			"first answer",
		]);
		expect(streaming).toEqual([true, false]);
		expect(errors).toEqual([null]);
	});
	it("retains partial text when the upstream stream fails", async () => {
		const c = container(),
			{ options, errors } = runOptions(c),
			thread = fixture();
		stream.mockImplementation(async (_messages, _context, delta) => {
			delta("partial evidence");
			throw new Error("streamInterrupted");
		});
		await runAskTurn({ ...options, thread, question: "Why?" });
		expect(c.persisted.at(-1)?.messages.at(-1)?.content).toBe(
			"partial evidence",
		);
		expect(errors).toEqual([null, "streamInterrupted"]);
	});
	it("cancels the fetch and preserves the partial answer", async () => {
		const c = container(),
			{ options } = runOptions(c),
			thread = fixture();
		stream.mockImplementation(
			async (_messages, _context, delta, signal: AbortSignal) => {
				delta("keep this");
				await new Promise((_resolve, reject) =>
					signal.addEventListener("abort", () => reject(new Error("aborted")), {
						once: true,
					}),
				);
			},
		);
		const pending = runAskTurn({ ...options, thread, question: "Why?" });
		await vi.waitFor(() => expect(stream).toHaveBeenCalledOnce());
		stopAskRun(options.sessionRef, options.activeSessionRef, () => undefined);
		await pending;
		expect(c.persisted.at(-1)?.messages.at(-1)?.content).toBe("keep this");
		expect(options.sessionRef.current).toBeNull();
	});
	it("checkpoints during streaming and cancels on viewer teardown without losing the last chunk", async () => {
		const c = container(),
			{ options } = runOptions(c),
			thread = fixture();
		let delta!: (text: string) => void;
		stream.mockImplementation(
			async (_messages, _context, append, signal: AbortSignal) => {
				delta = append;
				append("checkpoint");
				await new Promise((_resolve, reject) =>
					signal.addEventListener("abort", () => reject(new Error("aborted")), {
						once: true,
					}),
				);
			},
		);
		const pending = runAskTurn({ ...options, thread, question: "Why?" });
		await vi.waitFor(
			() =>
				expect(c.persisted.at(-1)?.messages.at(-1)?.content).toBe("checkpoint"),
			{ timeout: 2000 },
		);
		delta(" last chunk");
		options.disposedRef.current = true;
		for (const cancel of options.unsubsRef.current ?? []) cancel();
		await pending;
		expect(c.persisted.at(-1)?.messages.at(-1)?.content).toBe(
			"checkpoint last chunk",
		);
		expect(options.unsubsRef.current).toBeNull();
	});
	it("resend excludes the edited user turn and all later messages", () => {
		const messages = [
			{ id: "u", role: "user" as const, content: "why", createdAt: "now" },
			{
				id: "a",
				role: "assistant" as const,
				content: "answer",
				createdAt: "now",
			},
		];
		expect(resendBaseMessages(messages, "u")).toEqual([]);
		expect(resendBaseMessages(messages, "a")).toBeNull();
	});
});
