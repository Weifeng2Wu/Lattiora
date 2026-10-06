import i18n from "@/i18n";
import type { AiConfig, ChatEvent, ChatMessage } from "./protocol";

export type PublicAiConfig = Omit<AiConfig, "apiKey"> & { hasKey: boolean };

export function cloudAiError(error: unknown): string {
	const code = error instanceof Error ? error.message : String(error);
	return i18n.t(`cloud:errors.${code}`, {
		defaultValue: i18n.t("cloud:errors.requestFailed"),
	});
}

async function checked(response: Response): Promise<Response> {
	if (response.ok) return response;
	const body = (await response.json().catch(() => ({}))) as { error?: string };
	throw new Error(
		body.error || (response.status === 401 ? "unauthorized" : "requestFailed"),
	);
}

export async function aiRequest<T>(
	path: string,
	body?: unknown,
	signal?: AbortSignal,
	method?: string,
): Promise<T> {
	if (!navigator.onLine) throw new Error("offline");
	const response = await fetch(`/api/ai/${path}`, {
		method: method ?? (body === undefined ? "GET" : "POST"),
		headers:
			body === undefined ? undefined : { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
		signal,
	});
	await checked(response);
	return response.status === 204 ? (undefined as T) : response.json();
}

export const getAiConfig = () => aiRequest<PublicAiConfig | null>("config");
export const saveAiConfig = (
	config: Omit<AiConfig, "apiKey"> & { apiKey?: string },
) => aiRequest<PublicAiConfig>("config", config, undefined, "PUT");
export const deleteAiConfig = () =>
	aiRequest<void>("config", undefined, undefined, "DELETE");

/** Parse incremental SSE frames, including split UTF-8 and CRLF boundaries. */
export async function consumeChatStream(
	body: ReadableStream<Uint8Array>,
	onDelta: (text: string) => void,
	signal?: AbortSignal,
): Promise<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let output = "";
	let completed = false;
	try {
		while (true) {
			signal?.throwIfAborted();
			const { value, done } = await reader.read();
			buffer += decoder.decode(value, { stream: !done });
			while (true) {
				const frameEnd = /\r?\n\r?\n/.exec(buffer);
				if (!frameEnd) break;
				const frame = buffer.slice(0, frameEnd.index);
				buffer = buffer.slice(frameEnd.index + frameEnd[0].length);
				const data = frame
					.split(/\r?\n/)
					.filter((line) => line.startsWith("data:"))
					.map((line) => line.slice(5).trimStart())
					.join("\n");
				if (!data) continue;
				const event = JSON.parse(data) as ChatEvent;
				if (event.type === "error") throw new Error(event.error);
				if (event.type === "done") {
					if (!["stop", "end_turn"].includes(event.reason))
						throw new Error("incompleteResponse");
					completed = true;
					break;
				}
				if (event.type === "delta" && typeof event.text === "string") {
					output += event.text;
					onDelta(event.text);
				}
			}
			if (completed) break;
			if (done) throw new Error("streamInterrupted");
		}
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
	return output;
}

export async function streamChat(
	messages: ChatMessage[],
	context: string,
	onDelta: (text: string) => void,
	signal?: AbortSignal,
): Promise<string> {
	if (!navigator.onLine) throw new Error("offline");
	const response = await checked(
		await fetch("/api/ai/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ messages, context }),
			signal,
		}),
	);
	if (!response.body) throw new Error("streamInterrupted");
	return consumeChatStream(response.body, onDelta, signal);
}

export async function translateCloudText(
	text: string,
	targetLang: string,
	customPrompt?: string,
	signal?: AbortSignal,
): Promise<string> {
	const result = await aiRequest<{ text: string }>(
		"translate",
		{ text, targetLang, customPrompt },
		signal,
	);
	if (!result.text?.trim()) throw new Error("emptyResponse");
	return result.text;
}

export async function ocrCloudImage(
	image: string,
	prompt?: string,
	signal?: AbortSignal,
): Promise<string> {
	const result = await aiRequest<{ text: string }>(
		"ocr",
		{ image, prompt },
		signal,
	);
	if (!result.text?.trim()) throw new Error("emptyResponse");
	return result.text;
}
