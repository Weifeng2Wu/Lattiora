import { describe, expect, it } from "vitest";
import { normalizeStream, parseSse, providerRequest } from "../cloudflare/ai";
import {
	authenticated,
	decrypt,
	encrypt,
	session,
} from "../cloudflare/security";
import {
	type AiConfig,
	providerEndpoint,
	validPath,
} from "../src/lib/cloud/protocol";

const baseConfig: AiConfig = {
	provider: "openai",
	baseUrl: "https://models.example.com/v1",
	model: "test-model",
	apiKey: "private-test-key",
};
function chunks(text: string, width = 1) {
	const bytes = new TextEncoder().encode(text);
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (let i = 0; i < bytes.length; i += width)
				controller.enqueue(bytes.slice(i, i + width));
			controller.close();
		},
	});
}
async function collect<T>(iterator: AsyncIterable<T>) {
	const output: T[] = [];
	for await (const item of iterator) output.push(item);
	return output;
}

describe("Cloudflare provider protocols", () => {
	it("preserves a custom API prefix and rejects endpoints with credentials, local IPs or query strings", () => {
		expect(providerEndpoint("https://models.example.com", "openai")).toBe(
			"https://models.example.com/v1/chat/completions",
		);
		expect(
			providerEndpoint(
				"https://models.example.com/custom/messages/",
				"anthropic",
			),
		).toBe("https://models.example.com/custom/messages");
		for (const base of [
			"http://models.example.com",
			"https://127.0.0.1",
			"https://[::1]",
			"https://user:key@models.example.com",
			"https://models.example.com/?key=secret",
			"https://service.internal",
		]) {
			expect(() => providerEndpoint(base, "openai")).toThrow("invalidEndpoint");
		}
	});
	it("maps vision pages and authentication for both provider protocols", () => {
		const image = "data:image/png;base64,aGVsbG8=";
		const messages = [{ role: "user" as const, content: "Transcribe", image }];
		const openai = providerRequest(baseConfig, messages, "");
		const anthropic = providerRequest(
			{ ...baseConfig, provider: "anthropic" },
			messages,
			"",
		);
		expect(openai.init.headers).toMatchObject({
			authorization: "Bearer private-test-key",
		});
		expect(JSON.parse(String(openai.init.body)).messages[1].content[0]).toEqual(
			{ type: "image_url", image_url: { url: image } },
		);
		expect(anthropic.init.headers).toMatchObject({
			"x-api-key": "private-test-key",
			"anthropic-version": "2023-06-01",
		});
		expect(
			JSON.parse(String(anthropic.init.body)).messages[0].content[0],
		).toEqual({
			type: "image",
			source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" },
		});
		expect(openai.init.redirect).toBe("manual");
	});
	it("parses split UTF-8, CRLF, bare CR, comments and multiline SSE data", async () => {
		const parsed = await collect(
			parseSse(
				chunks(
					": keepalive\r\ndata: 中文\r\ndata: next\r\n\r\ndata: done\r\rdata: unterminated",
				),
			),
		);
		expect(parsed).toEqual(["中文\nnext", "done"]);
	});
	it("normalizes complete OpenAI and Anthropic responses", async () => {
		const openai =
			'data: {"choices":[{"delta":{"content":"答案"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n';
		expect(await collect(normalizeStream(chunks(openai), "openai"))).toEqual([
			{ type: "delta", text: "答案" },
			{ type: "done", reason: "length" },
		]);
		const anthropic =
			'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Answer"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\ndata: {"type":"message_stop"}\n\n';
		expect(
			await collect(normalizeStream(chunks(anthropic), "anthropic")),
		).toEqual([
			{ type: "delta", text: "Answer" },
			{ type: "done", reason: "end_turn" },
		]);
	});
	it("rejects truncated responses and provider error events", async () => {
		await expect(
			collect(
				normalizeStream(
					chunks('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
					"openai",
				),
			),
		).rejects.toThrow("streamInterrupted");
		await expect(
			collect(
				normalizeStream(
					chunks(
						'data: {"type":"error","error":{"message":"credential details"}}\n\n',
					),
					"anthropic",
				),
			),
		).rejects.toThrow("providerError");
	});
});

describe("Cloudflare credentials", () => {
	it("authenticates only intact signed sessions and rejects a rotated password", async () => {
		const password = "this-is-a-test-password-with-32-characters";
		const token = await session(password);
		const request = (value: string) =>
			new Request("https://app.example.com/api/session", {
				headers: { cookie: `agentero_session=${value}` },
			});
		expect(await authenticated(request(token), password)).toBe(true);
		expect(await authenticated(request(`${token}.extra`), password)).toBe(
			false,
		);
		expect(await authenticated(request(token), `${password}-rotated`)).toBe(
			false,
		);
		expect(
			await authenticated(request(token.replace(/^\d/, "0")), password),
		).toBe(false);
	});
	it("encrypts configuration with authenticated encryption and detects tampering", async () => {
		const key = "ab".repeat(32);
		const encrypted = await encrypt(baseConfig, key);
		expect(encrypted).not.toContain(baseConfig.apiKey);
		expect(await decrypt(encrypted, key)).toEqual(baseConfig);
		const modified = JSON.parse(encrypted);
		modified.ciphertext[0] ^= 1;
		await expect(decrypt(JSON.stringify(modified), key)).rejects.toThrow();
		await expect(decrypt(encrypted, "cd".repeat(32))).rejects.toThrow();
	});
	it("rejects traversal and platform separators while accepting Unicode vault paths", () => {
		expect(validPath("论文/研究笔记.md")).toBe(true);
		for (const path of [
			"../secret",
			"/root/file",
			"a/../b",
			"a\\b",
			"a//b",
			"a\u0000b",
		])
			expect(validPath(path)).toBe(false);
	});
});
