import { readdir, readFile } from "node:fs/promises";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { redactSettings } from "../src/lib/cloud/settings-secrets";

const origin = "https://workspace.test";
let mf: Miniflare;
let cookie: string;
let calls: Array<{ url: URL; headers: Headers; body: any }> = [];
let fixture: unknown = null;
async function request(
	path: string,
	body?: unknown,
	method = body === undefined ? "GET" : "POST",
) {
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
				const text = await req.text();
				calls.push({
					url: new URL(req.url),
					headers: new Headers(req.headers),
					body: text
						? req.headers.get("content-type")?.includes("application/json")
							? JSON.parse(text)
							: Object.fromEntries(new URLSearchParams(text))
						: null,
				});
				return Response.json(fixture);
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
	const response = await request("/api/session", {
		password: "testing-password-more-than-32-characters",
	});
	expect(response.status).toBe(200);
	cookie = response.headers.get("set-cookie")!.split(";")[0];
}, 30000);
afterAll(async () => {
	await mf?.dispose();
});

async function secret(name: string, value: string, version = 0) {
	return request("/api/settings/secrets", { name, value, version }, "PUT");
}
describe("independent server credentials", () => {
	it("encrypts each key, returns only status, rejects unauthenticated writes and stale devices", async () => {
		const name = "translate.providerConfigs.openaiCompatible.apiKey";
		expect((await secret(name, "private-translation-key")).status).toBe(200);
		const statuses = await request("/api/settings/secrets");
		const publicText = await statuses.text();
		expect(publicText).not.toContain("private-translation-key");
		expect(JSON.parse(publicText).secrets).toContainEqual({
			name,
			version: 1,
			configured: 1,
		});
		const db = await mf.getD1Database("DB");
		const row = await db
			.prepare("SELECT value FROM settings_secrets WHERE name = ?")
			.bind(name)
			.first<{ value: string }>();
		expect(row!.value).not.toContain("private-translation-key");
		expect((await secret(name, "device-B-stale-key")).status).toBe(409);
		expect((await secret(name, "********", 1)).status).toBe(400);
		expect(
			(await mf.dispatchFetch(origin + "/api/settings/secrets")).status,
		).toBe(401);
		expect(
			(
				await mf.dispatchFetch(origin + "/api/settings/secrets", {
					method: "PUT",
					headers: { cookie, origin: "https://evil.test" },
				})
			).status,
		).toBe(403);
	});
	it("redacts keys recursively without mutating prompts or model configuration", () => {
		const raw = {
			embedding: { apiKey: "private", model: "embedding-v3" },
			translate: {
				providerConfigs: { deepl: { apiKey: "deepl-private" } },
				customPrompt: "Translate {{targetLang}}",
			},
			mcpTunnelApiKey: "retired-key",
		};
		const clean = redactSettings(raw);
		expect(JSON.stringify(clean)).not.toContain("private");
		expect(clean.embedding.model).toBe("embedding-v3");
		expect(clean.translate.customPrompt).toBe(raw.translate.customPrompt);
		expect(raw.embedding.apiKey).toBe("private");
	});
});
describe("upstream translation protocols", () => {
	it.each([
		"huoshanweb",
		"deeplx",
	])("requires an endpoint for %s without a public default", async (provider) => {
		calls = [];
		const response = await request("/api/translate", {
			provider,
			text: "Hello",
			targetLang: "en",
		});
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: "endpointRequired" });
		expect(calls).toHaveLength(0);
	});

	it("uses the independent OpenAI key, custom endpoint/model/prompt and preserves batch rules", async () => {
		fixture = { choices: [{ message: { content: "[[1]] 你好" } }] };
		calls = [];
		const response = await request("/api/translate", {
			provider: "openaiCompatible",
			text: "[[1]] Hello",
			targetLang: "zh-CN",
			baseUrl: "https://provider.test/custom/v1",
			model: "translation-model",
			apiKey: "********",
			customPrompt: "Formal {{targetLang}} from {{sourceLang}}",
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ text: "[[1]] 你好" });
		expect(calls[0].url.pathname).toBe("/custom/v1/chat/completions");
		expect(calls[0].headers.get("authorization")).toBe(
			"Bearer private-translation-key",
		);
		expect(calls[0].body.model).toBe("translation-model");
		expect(calls[0].body.messages[1].content).toContain(
			"Formal Simplified Chinese from the source language",
		);
		expect(calls[0].body.messages[1].content).toContain("same [[n]] markers");
	});
	it.each([
		"openai",
		"anthropic",
	])("runs unified translation using the configured %s protocol", async (provider) => {
		await request(
			"/api/ai/config",
			{
				provider,
				baseUrl: "https://models.test/v1",
				model: "default-model",
				apiKey: "private-unified-key",
			},
			"PUT",
		);
		fixture =
			provider === "anthropic"
				? { content: [{ type: "text", text: "译文" }] }
				: { choices: [{ message: { content: "译文" } }] };
		calls = [];
		expect(
			(
				await request("/api/translate", {
					provider: "agent",
					text: "Hello",
					targetLang: "zh-CN",
					model: "translation-override",
				})
			).status,
		).toBe(200);
		expect(calls[0].body.model).toBe("translation-override");
		expect(calls[0].url.pathname).toBe(
			provider === "anthropic" ? "/v1/messages" : "/v1/chat/completions",
		);
		expect(
			calls[0].headers.get(
				provider === "anthropic" ? "x-api-key" : "authorization",
			),
		).toBe(
			provider === "anthropic"
				? "private-unified-key"
				: "Bearer private-unified-key",
		);
	});
	it.each([
		["google", [[["你好", "Hello"]]]],
		["googleapi", [[["你好", "Hello"]]]],
		["deeplx", { result: { texts: [{ text: "你好" }] } }],
		["huoshanweb", { translation: "你好" }],
		["tencenttransmart", { auto_translation: ["你好"] }],
		["deepl", { translations: [{ text: "你好" }] }],
		["azure", [{ translations: [{ text: "你好" }] }]],
		["googleCloud", { data: { translations: [{ translatedText: "你好" }] } }],
	])("preserves original %s request and response contracts", async (provider, result) => {
		fixture = result;
		calls = [];
		const response = await request("/api/translate", {
			provider,
			text: "Hello",
			sourceLang: "auto",
			targetLang: "zh-CN",
			apiKey: "byok-key",
			region: "eastasia",
			baseUrl: "https://translation.example",
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ text: "你好" });
		expect(calls).toHaveLength(1);
		if (provider === "google" || provider === "googleapi")
			expect(calls[0].url.searchParams.get("q")).toBe("Hello");
		if (provider === "azure") {
			expect(calls[0].headers.get("Ocp-Apim-Subscription-Region")).toBe(
				"eastasia",
			);
			expect(calls[0].body).toEqual([{ Text: "Hello" }]);
		}
		if (provider === "deepl")
			expect(calls[0].body).toMatchObject({ text: "Hello", target_lang: "ZH" });
		if (provider === "googleCloud")
			expect(calls[0].headers.get("x-goog-api-key")).toBe("byok-key");
	});
	it.each([
		[
			"tencenttransmart",
			"https://transmart.qq.com/api/imt",
			{ auto_translation: ["你好"] },
		],
		[
			"google",
			"https://translate.google.com/translate_a/single",
			[[["你好", "Hello"]]],
		],
		[
			"googleapi",
			"https://translate.googleapis.com/translate_a/single",
			[[["你好", "Hello"]]],
		],
	])("uses the keyless default endpoint for %s", async (provider, endpoint, result) => {
		fixture = result;
		for (const baseUrl of [undefined, "", "  "]) {
			calls = [];
			const response = await request("/api/translate", {
				provider,
				text: "Hello",
				targetLang: "zh-CN",
				baseUrl,
			});
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ text: "你好" });
			expect(calls).toHaveLength(1);
			expect(calls[0].url.origin + calls[0].url.pathname).toBe(endpoint);
			expect(calls[0].headers.has("authorization")).toBe(false);
		}
	});
	it("rejects local endpoints and malformed/empty results without forwarding provider payloads", async () => {
		fixture = { error: { message: "private-upstream-token" } };
		calls = [];
		const response = await request("/api/translate", {
			provider: "openaiCompatible",
			text: "Hi",
			targetLang: "en",
			apiKey: "byok",
			model: "m",
			baseUrl: "https://127.0.0.1/v1",
		});
		expect(response.status).toBe(400);
		expect(calls).toHaveLength(0);
		const bad = await request("/api/translate", {
			provider: "google",
			baseUrl: "https://translation.example",
			text: "Hi",
			targetLang: "en",
		});
		expect(bad.status).toBe(502);
		expect(await bad.text()).not.toContain("private-upstream-token");
	});
});
describe("embedding compatibility", () => {
	it("uses a separate encrypted key and validates/reorders batch vectors", async () => {
		await secret("embedding.apiKey", "private-embedding-key");
		calls = [];
		fixture = {
			data: [
				{ index: 1, embedding: [0, 1, 0] },
				{ index: 0, embedding: [1, 0, 0] },
			],
		};
		const input = {
			baseUrl: "https://embeddings.test/custom/v1",
			model: "embedding-v3",
			apiKey: "********",
			input: ["paper A", "paper B"],
		};
		const response = await request("/api/embedding", input);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			vectors: [
				[1, 0, 0],
				[0, 1, 0],
			],
			dim: 3,
		});
		expect(calls[0].url.pathname).toBe("/custom/v1/embeddings");
		expect(calls[0].headers.get("authorization")).toBe(
			"Bearer private-embedding-key",
		);
		fixture = {
			data: [
				{ index: 0, embedding: [1] },
				{ index: 0, embedding: [2] },
			],
		};
		expect((await request("/api/embedding", input)).status).toBe(502);
	});
	it("clears a key using CAS and does not resurrect it from a mask", async () => {
		expect((await secret("embedding.apiKey", "", 1)).status).toBe(200);
		expect(
			(
				await request("/api/embedding", {
					baseUrl: "https://embeddings.test/v1",
					model: "m",
					input: ["test"],
					apiKey: "********",
				})
			).status,
		).toBe(409);
	});
});

it("probes deployed storage bindings and EasyScholar through authenticated Worker routes", async () => {
	fixture = {
		code: 200,
		data: {
			officialRank: { all: { sciif: "12.3", nested: { ignored: true } } },
		},
	};
	await secret("easyScholarKey", "private-scholar-key");
	calls = [];
	const rank = await request("/api/easyscholar", { publication: "Nature" });
	expect(rank.status).toBe(200);
	expect(await rank.json()).toEqual({
		code: 200,
		data: { officialRank: { all: { sciif: "12.3" } } },
	});
	expect(calls[0].url.searchParams.get("secretKey")).toBe(
		"private-scholar-key",
	);
	const diagnostics = await request("/api/diagnostics");
	expect(diagnostics.status).toBe(200);
	expect(await diagnostics.json()).toMatchObject({
		database: true,
		objectStorage: true,
	});
});
