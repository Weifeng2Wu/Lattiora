import { z } from "zod";
import i18n from "@/i18n";
import type {
	AcpHistoryLine,
	AcpHistoryPart,
	AskUserRequest,
	PermissionRequest,
	RunOnceAccepted,
} from "@/lib/agent/api";
import type { ChatLine } from "@/lib/agent/chat-state";
import { emit } from "@/lib/core/browser-events";
import { agentDocumentContext, readAgentDocument } from "./agent-documents";
import { assertAgentDocumentClean, writeAgentNote } from "./agent-edits";
import type {
	AgentEvent,
	AgentMessage,
	AgentStep,
	AgentToolCall,
} from "./agent-protocol";
import {
	type BrowserAgentSession,
	historyLines,
	messagesFromLines,
	newSessionPath,
	readBrowserSession,
	sessionWriter,
} from "./agent-sessions";
import { cloudAiError } from "./ai";
import { cloudRelative, listLocalFiles } from "./files";
import { skillInstructions, vaultInstructions } from "./skills";

export type BrowserRunRequest = {
	agentId?: string;
	sessionId?: string;
	prompt: string;
	images?: { data: string; mimeType: string }[];
	contextPaths?: string[];
	historyLines?: ChatLine[];
	workflow?: string;
	target?: string;
	modelId?: string;
	skillIds?: string[];
	permissionMode?: string;
	responseLanguage?: string;
	personalPrompt?: string;
	hideFromChatHistory?: boolean;
	collaborationModeId?: string;
};
const active = new Map<string, AbortController>();
const pending = new Map<
	string,
	{ kind: "permission" | "ask"; resolve: (answer: unknown) => void }
>();
export async function answerAgentRequest(
	id: string,
	kind: "permission" | "ask",
	answer: unknown,
) {
	const request = pending.get(id);
	if (!request || request.kind !== kind) throw new Error("requestExpired");
	request.resolve(answer);
}
export async function cancelBrowserRun(id: string) {
	active.get(id)?.abort();
}
function waitForAnswer(
	id: string,
	kind: "permission" | "ask",
	signal: AbortSignal,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			pending.delete(id);
			signal.removeEventListener("abort", aborted);
		};
		const aborted = () => {
			cleanup();
			reject(new DOMException("Aborted", "AbortError"));
		};
		pending.set(id, {
			kind,
			resolve: (value) => {
				cleanup();
				resolve(value);
			},
		});
		signal.addEventListener("abort", aborted, { once: true });
		if (signal.aborted) aborted();
	});
}

export async function* streamAgentStep(
	step: AgentStep,
	signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
	const response = await fetch("/api/ai/agent", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(step),
		signal,
	});
	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		throw new Error(body.error || "requestFailed");
	}
	if (!response.body) throw new Error("streamInterrupted");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		for (;;) {
			signal.throwIfAborted();
			const { value, done } = await reader.read();
			buffer += decoder.decode(value, { stream: !done });
			let boundary = /\r?\n\r?\n/.exec(buffer);
			while (boundary) {
				const frame = buffer.slice(0, boundary.index);
				buffer = buffer.slice(boundary.index + boundary[0].length);
				const data = frame
					.split(/\r?\n/)
					.filter((l) => l.startsWith("data:"))
					.map((l) => l.slice(5).trimStart())
					.join("\n");
				if (data) {
					const event = JSON.parse(data) as AgentEvent;
					if (event.type === "error") throw new Error(event.error);
					yield event;
					if (event.type === "done") return;
				}
				boundary = /\r?\n\r?\n/.exec(buffer);
			}
			if (done) throw new Error("streamInterrupted");
		}
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}

const pathSchema = z.string().min(1).max(1024);
export async function executeAgentTool(
	call: AgentToolCall,
	opts: {
		sessionId: string;
		signal: AbortSignal;
		readOnly: boolean;
		permissionMode?: string;
	},
) {
	const { sessionId, signal } = opts;
	signal.throwIfAborted();
	const args: unknown = JSON.parse(call.arguments);
	switch (call.name) {
		case "list_files": {
			const { prefix = "" } = z
				.object({ prefix: z.string().max(1024).optional() })
				.strict()
				.parse(args);
			const files = (await listLocalFiles()).filter(
				(f) =>
					!f.deleted &&
					!f.path.startsWith(".agentero/") &&
					!f.path.startsWith(".trash/") &&
					f.path.startsWith(prefix),
			);
			return {
				files: files.slice(0, 1000).map((f) => ({
					path: f.path,
					cached: Boolean(f.data),
					size: f.size,
				})),
				truncated: files.length > 1000,
			};
		}
		case "read_document": {
			const {
				path,
				start = 0,
				length = 60000,
			} = z
				.object({
					path: pathSchema,
					start: z.number().int().min(0).optional(),
					length: z.number().int().min(1).max(60000).optional(),
				})
				.strict()
				.parse(args);
			const text = await readAgentDocument(path, signal);
			return {
				path,
				text: text.slice(start, start + length),
				totalCharacters: text.length,
				truncated: start + length < text.length,
				nextStart: Math.min(text.length, start + length),
			};
		}
		case "search_documents": {
			const { query, prefix = "" } = z
				.object({
					query: z.string().min(1).max(500),
					prefix: z.string().max(1024).optional(),
				})
				.strict()
				.parse(args);
			const matches = [];
			let scanned = 0;
			for (const file of await listLocalFiles()) {
				signal.throwIfAborted();
				if (
					file.deleted ||
					!file.data ||
					!file.path.startsWith(prefix) ||
					file.path.startsWith(".agentero/") ||
					file.path.startsWith(".trash/") ||
					!/\.(md|txt|tex|json)$/i.test(file.path)
				)
					continue;
				if (++scanned > 1000) break;
				const text = await file.data.text();
				const index = text.toLowerCase().indexOf(query.toLowerCase());
				if (index >= 0)
					matches.push({
						path: file.path,
						snippet: text.slice(
							Math.max(0, index - 120),
							index + query.length + 280,
						),
					});
				if (matches.length >= 50) break;
			}
			return {
				matches,
				scope: "cached text files only",
				truncated: matches.length >= 50 || scanned > 1000,
			};
		}
		case "write_note": {
			if (opts.readOnly) throw new Error("permissionDenied");
			const {
				path: source,
				content,
				expectedText,
			} = z
				.object({
					path: pathSchema,
					content: z.string().max(256000),
					expectedText: z.string().max(256000).nullable(),
				})
				.strict()
				.parse(args);
			const path = cloudRelative(source);
			if (
				!/\.(md|txt|tex|bib|excalidraw)$/i.test(path) ||
				path.startsWith(".") ||
				path.startsWith("Conflicts/")
			)
				throw new Error("invalidPath");
			// Flush mounted editors before the CAS check so an unsaved user edit wins.
			const { flushAllTextEditors } = await import(
				"@/lib/workspace/text-editor-flush"
			);
			if (!(await flushAllTextEditors())) throw new Error("localConflict");
			await assertAgentDocumentClean(path);
			if (opts.permissionMode !== "auto") {
				const requestId = crypto.randomUUID();
				const response = waitForAnswer(requestId, "permission", signal);
				await emit<PermissionRequest>("agent:permission-request", {
					requestId,
					sessionId,
					title: i18n.t("agent:web.writePermission"),
					paths: [path],
					kind: "edit",
					options: [{ optionId: "allow", name: "", kind: "allow_once" }],
					preview: { before: expectedText ?? "", after: content },
				});
				if ((await response) !== "allow") throw new Error("permissionDenied");
			}
			signal.throwIfAborted();
			if (!(await flushAllTextEditors())) throw new Error("localConflict");
			await assertAgentDocumentClean(path);
			return writeAgentNote(path, content, expectedText);
		}
		case "update_plan": {
			const { entries } = z
				.object({
					entries: z
						.array(
							z
								.object({
									content: z.string().min(1).max(2000),
									status: z.enum(["pending", "in_progress", "completed"]),
								})
								.strict(),
						)
						.max(12),
				})
				.strict()
				.parse(args);
			await emit("agent:plan", {
				sessionId,
				entries: entries.map((e) => ({ ...e, priority: "medium" })),
			});
			return { updated: true };
		}
		case "ask_user": {
			const { question, options = [] } = z
				.object({
					question: z.string().min(1).max(4000),
					options: z.array(z.string().max(500)).max(6).optional(),
				})
				.strict()
				.parse(args);
			const requestId = crypto.randomUUID();
			const response = waitForAnswer(requestId, "ask", signal);
			await emit<AskUserRequest>("agent:ask-user-request", {
				requestId,
				sessionId,
				toolCallId: call.id,
				mode: "default",
				questions: [
					{
						question,
						options: options.map((label) => ({ label })),
						multiSelect: false,
						allowOther: true,
					},
				],
			});
			return await response;
		}
		default:
			throw new Error("unsupportedTool");
	}
}

/** Runtime ids are fresh per turn; the durable id is a synchronized session file path. */
export async function runBrowserAgent(
	request: BrowserRunRequest,
): Promise<RunOnceAccepted> {
	if (!navigator.onLine) throw new Error(cloudAiError(new Error("offline")));
	if (request.agentId && request.agentId !== "cloud")
		throw new Error(cloudAiError(new Error("unsupportedAgent")));
	if (!request.prompt.trim())
		throw new Error(cloudAiError(new Error("invalidMessages")));
	const { prepareBrowserPromptImages } = await import(
		"@/lib/agent/prompt-image"
	);
	const images = await prepareBrowserPromptImages(request.images ?? []);
	const last = request.historyLines?.at(-1);
	if (last?.kind === "user") {
		const imageMap = new Map(
			(request.images ?? []).map((image, i) => [image.data, images[i]]),
		);
		request = {
			...request,
			historyLines: [
				...request.historyLines!.slice(0, -1),
				{
					...last,
					images: last.images?.map(
						(image) => imageMap.get(image.data) ?? image,
					),
					visualAnnotations: last.visualAnnotations?.map((item) => ({
						...item,
						image: imageMap.get(item.image.data) ?? item.image,
					})),
				},
			],
		};
	}
	request = { ...request, images };
	const accepted = {
		agentId: "cloud",
		sessionId: crypto.randomUUID(),
		messageId: crypto.randomUUID(),
	};
	const abort = new AbortController();
	active.set(accepted.sessionId, abort);
	// Defer beyond acceptance so existing event correlation/visual bindings can attach.
	setTimeout(() => {
		void run(request, accepted, abort);
	}, 0);
	return accepted;
}
async function run(
	request: BrowserRunRequest,
	accepted: RunOnceAccepted,
	abort: AbortController,
) {
	const { sessionId, messageId } = accepted;
	const signal = abort.signal;
	let session: BrowserAgentSession | undefined;
	let writer: ReturnType<typeof sessionWriter> | undefined;
	let checkpoint: ReturnType<typeof setInterval> | undefined;
	let finalText = "";
	const writtenPaths: string[] = [];
	let persistedError: unknown;
	const publish = (name: string, data: object) =>
		emit(`agent:${name}`, { sessionId, ...data });
	try {
		await publish("status", { phase: "starting" });
		let previous = request.sessionId
			? await readBrowserSession(request.sessionId)
			: undefined;
		if (previous && request.historyLines) {
			const canonical = (lines: AcpHistoryLine[]) =>
				JSON.stringify(
					lines.map((line) => ({ kind: line.kind, text: line.text.trim() })),
				);
			if (
				canonical(historyLines(request.historyLines).slice(0, -1)) !==
				canonical(previous.value.lines)
			)
				previous = undefined;
		}
		const lines = request.historyLines
			? historyLines(request.historyLines)
			: [
					...(previous?.value.lines ?? []),
					{
						id: crypto.randomUUID(),
						kind: "user" as const,
						text: request.prompt,
						images: request.images,
					},
				];
		const prior =
			previous?.value.messages ?? messagesFromLines(lines.slice(0, -1));
		const messages: AgentMessage[] = [
			...prior,
			{ role: "user", content: request.prompt, images: request.images },
		];
		session = {
			format: 1,
			title:
				previous?.value.title ||
				lines.find((l) => l.kind === "user")?.text.slice(0, 100) ||
				"Lattiora",
			updatedAt: Date.now(),
			lines,
			messages,
			hidden: request.hideFromChatHistory,
			interrupted: true,
		};
		writer = sessionWriter(
			previous && previous.path.includes("/agent-sessions/")
				? previous.path
				: newSessionPath(),
			previous && previous.path.includes("/agent-sessions/")
				? previous.raw
				: null,
		);
		await writer.write(session);
		const context = await agentDocumentContext(
			request.contextPaths ?? (request.target ? [request.target] : []),
			signal,
		);
		if (context)
			session.messages[session.messages.length - 1].content +=
				`\n\n<reference_documents>\n${context}\n</reference_documents>`;
		const skills = await skillInstructions(request.skillIds ?? []);
		const instructions = [
			`<vault_instructions>\n${await vaultInstructions()}\n</vault_instructions>`,
			request.personalPrompt,
			request.responseLanguage
				? `Respond and write notes in ${request.responseLanguage}.`
				: "",
			skills,
		]
			.filter(Boolean)
			.join("\n\n");
		if (instructions.length > 64000) throw new Error("contextTooLarge");
		const parts: AcpHistoryPart[] = [];
		const answer: AcpHistoryLine = {
			id: messageId,
			kind: "agent",
			text: "",
			parts,
		};
		session.lines.push(answer);
		checkpoint = setInterval(() => {
			if (session && writer)
				void writer.write(session).catch((error) => {
					persistedError = error;
					abort.abort();
				});
		}, 1500);
		const append = (type: "text" | "reasoning", text: string) => {
			const last = parts.at(-1);
			if (last?.type === type) last.text += text;
			else parts.push({ type, text });
			if (type === "text") answer.text += text;
		};
		const readOnly =
			request.permissionMode === "restricted" ||
			request.collaborationModeId === "plan";
		for (let step = 0; step < 12; step++) {
			signal.throwIfAborted();
			await publish("status", { phase: "waiting-model" });
			const calls: AgentToolCall[] = [];
			let text = "";
			for await (const event of streamAgentStep(
				{
					messages: session.messages,
					context: "",
					instructions,
					model: request.modelId,
					readOnly,
				},
				signal,
			)) {
				if (event.type === "delta" || event.type === "thought") {
					append(event.type === "delta" ? "text" : "reasoning", event.text);
					if (event.type === "delta") text += event.text;
					await publish("stream", {
						chunk: event.text,
						kind: event.type === "delta" ? "message" : "thought",
					});
				} else if (event.type === "tool_call") calls.push(event.call);
			}
			if (!text.trim() && !calls.length) throw new Error("emptyResponse");
			session.messages.push({
				role: "assistant",
				content: text,
				...(calls.length ? { toolCalls: calls } : {}),
			});
			if (!calls.length) {
				finalText = answer.text;
				session.interrupted = false;
				break;
			}
			for (const call of calls) {
				const tool = {
					id: call.id,
					title: call.name,
					kind: call.name === "write_note" ? "edit" : "other",
					status: "in_progress",
					input: JSON.parse(call.arguments),
					output: undefined as unknown,
				};
				parts.push({ type: "tool", tool });
				await publish("tool", { toolCallId: call.id, ...tool, full: true });
				try {
					if (request.hideFromChatHistory && call.name === "ask_user")
						throw new Error("unsupportedTool");
					tool.output = await executeAgentTool(call, {
						sessionId,
						signal,
						readOnly,
						permissionMode: request.permissionMode,
					});
					tool.status = "completed";
					if (call.name === "write_note")
						writtenPaths.push(cloudRelative(tool.input.path));
					if (call.name === "update_plan")
						parts.push({
							type: "plan",
							entries: (
								tool.input.entries as Array<{ content: string; status: string }>
							).map((e) => ({ ...e, priority: "medium" })),
						});
				} catch (error) {
					tool.status = "failed";
					tool.output = {
						error: signal.aborted
							? "cancelled"
							: error instanceof z.ZodError
								? "invalidToolArguments"
								: error instanceof Error
									? error.message
									: "toolFailed",
					};
				}
				session.messages.push({
					role: "tool",
					content: JSON.stringify(tool.output),
					toolCallId: call.id,
				});
				await publish("tool", { toolCallId: call.id, ...tool, full: true });
				await writer.write(session);
			}
			if (step === 11) throw new Error("agentStepLimit");
		}
		signal.throwIfAborted();
		clearInterval(checkpoint);
		session.updatedAt = Date.now();
		await writer.write(session);
		await publish("completed", {
			messageId,
			content: finalText,
			sources: request.contextPaths ?? [],
			providerSessionId: writer.path,
			stopReason: "end_turn",
			writtenPaths,
		});
	} catch (error) {
		clearInterval(checkpoint);
		if (session && writer) {
			session.interrupted = true;
			session.updatedAt = Date.now();
			await writer.write(session).catch((saveError) => {
				persistedError = saveError;
			});
		}
		await publish("failed", {
			error: cloudAiError(
				persistedError ||
					(signal.aborted ? new Error("agentCancelled") : error),
			),
		});
	} finally {
		active.delete(sessionId);
	}
}
