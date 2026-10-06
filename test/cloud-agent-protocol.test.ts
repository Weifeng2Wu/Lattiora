import { readdir, readFile } from "node:fs/promises";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeAgentStream } from "../cloudflare/agent";

const origin = "https://workspace.test";
let mf: Miniflare;
let cookie: string;
let fixture = "";
let upstream: { url: string; headers: Headers; body: any } | undefined;
const frame = (value: unknown) =>
	`data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`;
const stream = (body: string) => new Response(body).body!;
async function request(path: string, body?: unknown, method = "POST") {
	return mf.dispatchFetch(origin + path, {
		method,
		headers: { origin, cookie, "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}
beforeAll(async () => {
	const built = await build({
		entryPoints: ["cloudflare/worker.ts"],
		bundle: true,
		write: false,
		format: "esm",
		platform: "browser",
	});
	mf = new Miniflare(
		convertV4MiniflareOptions({
			modules: true,
			script: built.outputFiles[0].text,
			compatibilityDate: "2026-09-01",
			d1Databases: ["DB"],
			r2Buckets: ["FILES"],
			bindings: {
				ACCESS_PASSWORD: "testing-password-more-than-32-characters",
				ENCRYPTION_KEY: "ab".repeat(32),
			},
			ratelimits: {
				LOGIN_LIMIT: {
					namespace_id: "1002",
					simple: { limit: 1000, period: 60 },
				},
			},
			outboundService: async (req) => {
				upstream = {
					url: req.url,
					headers: new Headers(req.headers),
					body: await req.json(),
				};
				return new Response(fixture, {
					headers: { "content-type": "text/event-stream" },
				});
			},
		}),
	);
	const db = await mf.getD1Database("DB");
	for (const name of (await readdir("cloudflare/migrations")).sort())
		await db.exec(
			(await readFile(`cloudflare/migrations/${name}`, "utf8"))
				.replace(/--[^\n]*/g, "")
				.replace(/\n/g, " "),
		);
	cookie = (
		await request("/api/session", {
			password: "testing-password-more-than-32-characters",
		})
	).headers
		.get("set-cookie")!
		.split(";")[0];
}, 30000);
afterAll(async () => {
	await mf?.dispose();
});
const step = {
	messages: [
		{
			role: "user",
			content: "Read this paper",
			images: [{ mimeType: "image/png", data: "aGVsbG8=" }],
		},
	],
	context: "paper content",
	instructions: "Be precise",
};

describe("built-in Agent Worker protocols", () => {
	it("has no bundled model service and rejects invalid tool history before reaching an upstream", async () => {
		expect((await request("/api/ai/agent", step)).status).toBe(409);
		expect(
			(
				await request("/api/ai/agent", {
					...step,
					messages: [{ role: "tool", content: "done", toolCallId: "fake" }],
				})
			).status,
		).toBe(400);
		expect(upstream).toBeUndefined();
	});
	it("assembles fragmented OpenAI tool calls, preserves images, then sends actual tool results", async () => {
		await request(
			"/api/ai/config",
			{
				provider: "openai",
				baseUrl: "https://models.example/v1",
				model: "owner-model",
				apiKey: "owner-secret",
			},
			"PUT",
		);
		fixture =
			frame({
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call1",
									function: { name: "read_document", arguments: '{"path":' },
								},
							],
						},
					},
				],
			}) +
			frame({
				choices: [
					{
						delta: {
							tool_calls: [
								{ index: 0, function: { arguments: '"notes/source.md"}' } },
							],
						},
						finish_reason: "tool_calls",
					},
				],
			}) +
			frame("[DONE]");
		const result = await request("/api/ai/agent", step);
		expect(result.status).toBe(200);
		expect(await result.text()).toContain(
			'"arguments":"{\\"path\\":\\"notes/source.md\\"}"',
		);
		expect(upstream!.url).toBe("https://models.example/v1/chat/completions");
		expect(upstream!.headers.get("authorization")).toBe("Bearer owner-secret");
		expect(upstream!.body.messages[1].content[1].image_url.url).toContain(
			"data:image/png;base64,",
		);
		expect(upstream!.body.tools.map((t: any) => t.function.name)).toContain(
			"write_note",
		);
		fixture =
			frame({
				choices: [{ delta: { content: "The result" }, finish_reason: "stop" }],
			}) + frame("[DONE]");
		const next = await request("/api/ai/agent", {
			...step,
			messages: [
				...step.messages,
				{
					role: "assistant",
					content: "",
					toolCalls: [
						{
							id: "call1",
							name: "read_document",
							arguments: '{"path":"notes/source.md"}',
						},
					],
				},
				{ role: "tool", toolCallId: "call1", content: "actual source" },
			],
		});
		expect(await next.text()).toContain("The result");
		expect(upstream!.body.messages.at(-1)).toEqual({
			role: "tool",
			tool_call_id: "call1",
			content: "actual source",
		});
	});
	it("maps Anthropic tool_use/tool_result and user images without exposing the saved key", async () => {
		await request(
			"/api/ai/config",
			{
				provider: "anthropic",
				baseUrl: "https://anthropic.example/v1",
				model: "owner-claude",
				apiKey: "anthropic-secret",
			},
			"PUT",
		);
		fixture =
			frame({
				type: "content_block_start",
				index: 0,
				content_block: {
					type: "tool_use",
					id: "tool1",
					name: "write_note",
					input: {},
				},
			}) +
			frame({
				type: "content_block_delta",
				index: 0,
				delta: {
					type: "input_json_delta",
					partial_json:
						'{"path":"notes/a.md","content":"Note","expectedText":null}',
				},
			}) +
			frame({ type: "message_delta", delta: { stop_reason: "tool_use" } }) +
			frame({ type: "message_stop" });
		const body = await (await request("/api/ai/agent", step)).text();
		expect(body).toContain('"type":"tool_call"');
		expect(body).not.toContain("anthropic-secret");
		expect(upstream!.headers.get("x-api-key")).toBe("anthropic-secret");
		expect(upstream!.body.messages[0].content[1].source).toEqual({
			type: "base64",
			media_type: "image/png",
			data: "aGVsbG8=",
		});
		fixture =
			frame({
				type: "content_block_delta",
				delta: { type: "text_delta", text: "Saved" },
			}) +
			frame({ type: "message_delta", delta: { stop_reason: "end_turn" } }) +
			frame({ type: "message_stop" });
		await (
			await request("/api/ai/agent", {
				...step,
				readOnly: true,
				messages: [
					...step.messages,
					{
						role: "assistant",
						content: "",
						toolCalls: [{ id: "tool1", name: "write_note", arguments: "{}" }],
					},
					{ role: "tool", content: '{"saved":true}', toolCallId: "tool1" },
				],
			})
		).text();
		expect(upstream!.body.messages.at(-1).content[0]).toEqual({
			type: "tool_result",
			tool_use_id: "tool1",
			content: '{"saved":true}',
		});
		expect(upstream!.body.tools.map((t: any) => t.name)).not.toContain(
			"write_note",
		);
	});
	it.each([
		"eof",
		"length",
		"malformed",
	])("never emits an executable tool on %s", async (mode) => {
		const emitted = [];
		const content =
			frame({
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "bad",
									function: {
										name: "write_note",
										arguments: mode === "malformed" ? "{" : "{}",
									},
								},
							],
						},
						finish_reason: mode === "length" ? "length" : "tool_calls",
					},
				],
			}) + (mode === "eof" ? "" : frame("[DONE]"));
		await expect(
			(async () => {
				for await (const event of normalizeAgentStream(
					stream(content),
					"openai",
				))
					emitted.push(event);
			})(),
		).rejects.toThrow();
		expect(emitted).toEqual([]);
	});
});

it.each([
	{},
	{ prefix: "notes/" },
])("accepts Anthropic initial tool input without deltas: %j", async (input) => {
	const body =
		frame({
			type: "content_block_start",
			index: 0,
			content_block: {
				type: "tool_use",
				id: "empty",
				name: "list_files",
				input,
			},
		}) +
		frame({ type: "message_delta", delta: { stop_reason: "tool_use" } }) +
		frame({ type: "message_stop" });
	const events = [];
	for await (const event of normalizeAgentStream(stream(body), "anthropic"))
		events.push(event);
	expect(events).toContainEqual({
		type: "tool_call",
		call: { id: "empty", name: "list_files", arguments: JSON.stringify(input) },
	});
});
