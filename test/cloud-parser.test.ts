import { readdir, readFile } from "node:fs/promises";
import { build } from "esbuild";
import { strToU8, zipSync } from "fflate";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
	parseMineruResult,
	parsePaddleResult,
} from "@/lib/cloud/parser-result";

let mf: Miniflare, cookie: string;
const origin = "https://parser.test";
const calls: Array<{ url: URL; headers: Headers; body: unknown }> = [];
let scenario = "paddle",
	ready = false;
const paddle = {
	result: {
		layoutParsingResults: [
			{
				markdown: { text: "# Parsed paper" },
				prunedResult: {
					layout_det_res: {
						boxes: [
							{
								cls_id: 1,
								label: "image",
								score: 0.9,
								coordinate: [10, 20, 30, 40],
							},
						],
					},
				},
			},
		],
	},
};
const zip = zipSync({
	"full.md": strToU8("# MinerU\n![](images/a.png)"),
	"layout.json": strToU8(
		JSON.stringify({ pdf_info: [{ page_size: [600, 800] }] }),
	),
	"job_content_list.json": strToU8(
		JSON.stringify([
			{ page_idx: 0, type: "image", bbox: [100, 200, 500, 600] },
		]),
	),
	"images/a.png": new Uint8Array([1, 2, 3]),
});
async function request(path: string, body?: unknown) {
	return mf.dispatchFetch(origin + path, {
		method: body ? "POST" : "GET",
		headers: { origin, cookie, "content-type": "application/json" },
		body: body ? JSON.stringify(body) : undefined,
	});
}
beforeAll(async () => {
	const bundle = await build({
		entryPoints: ["cloudflare/worker.ts"],
		bundle: true,
		write: false,
		format: "esm",
		platform: "browser",
	});
	mf = new Miniflare(
		convertV4MiniflareOptions({
			modules: true,
			script: bundle.outputFiles[0].text,
			compatibilityDate: "2026-09-01",
			d1Databases: ["DB"],
			r2Buckets: ["FILES"],
			bindings: {
				ACCESS_PASSWORD: "parser-test-password-with-32-characters",
				ENCRYPTION_KEY: "ab".repeat(32),
			},
			ratelimits: {
				LOGIN_LIMIT: {
					namespace_id: "1003",
					simple: { limit: 1000, period: 60 },
				},
			},
			outboundService: async (req) => {
				const url = new URL(req.url);
				let body: unknown;
				if (req.headers.get("content-type")?.includes("multipart/form-data")) {
					const form = await req.formData();
					const file = form.get("file") as File;
					body = {
						model: form.get("model"),
						name: file.name,
						bytes: await file.text(),
					};
				} else {
					const raw = await req.text();
					try {
						body = JSON.parse(raw);
					} catch {
						body = raw;
					}
				}
				calls.push({ url, headers: new Headers(req.headers), body });
				if (scenario === "broken")
					return new Response("private upstream credential", { status: 503 });
				if (url.hostname === "result.test")
					return scenario === "mineru"
						? new Response(zip)
						: Response.json(null); // paddle handled below via alternate hostname
				if (url.hostname === "paddle-result.test")
					return new Response(JSON.stringify(paddle));
				if (url.hostname === "upload.test")
					return new Response(null, { status: 200 });
				if (url.pathname.endsWith("/models"))
					return Response.json({ data: [{ id: "ocr-model" }] });
				if (url.pathname.endsWith("/chat/completions"))
					return Response.json({
						choices: [{ message: { content: "transcribed" } }],
					});
				if (url.pathname.endsWith("/messages"))
					return Response.json({
						content: [{ type: "text", text: "transcribed" }],
					});
				if (url.pathname.endsWith("/file-urls/batch"))
					return Response.json({
						code: 0,
						data: {
							batch_id: "batch-1",
							file_urls: ["https://upload.test/file?signature=private"],
						},
					});
				if (url.pathname.includes("/extract-results/"))
					return Response.json({
						code: 0,
						data: {
							extract_result: [
								{
									state: ready ? "done" : "running",
									full_zip_url: "https://result.test/zip?signature=private",
								},
							],
						},
					});
				if (req.method === "POST")
					return Response.json({ data: { jobId: "paddle-1" } });
				return Response.json({
					data: {
						state: ready ? "done" : "running",
						resultUrl: {
							jsonUrl: "https://paddle-result.test/result?signature=private",
						},
						dataInfo: { pages: [{ width: 1200, height: 1600 }] },
					},
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
	const login = await request("/api/session", {
		password: "parser-test-password-with-32-characters",
	});
	cookie = login.headers.get("set-cookie")!.split(";")[0];
}, 30000);
afterAll(async () => {
	await mf?.dispose();
});
const input = (provider: string) => ({
	provider,
	id: crypto.randomUUID(),
	apiKey: "private-parser-key",
	pdfBase64: btoa("%PDF-1.7 fixture"),
	fileName: "paper.pdf",
	mode: "layout",
});
it("uses resumable Paddle jobs, encrypts credentials and caches results without leaking signed URLs", async () => {
	scenario = "paddle";
	ready = false;
	calls.length = 0;
	const body = input("paddle");
	expect((await request("/api/parser/jobs", body)).status).toBe(200);
	expect(calls[0].body).toMatchObject({
		model: "PP-StructureV3",
		name: "paper.pdf",
	});
	expect(calls[0].headers.get("authorization")).toBe(
		"Bearer private-parser-key",
	);
	await request("/api/parser/jobs", body);
	expect(calls).toHaveLength(1);
	expect(
		(await request("/api/parser/jobs", { ...body, fileName: "changed.pdf" }))
			.status,
	).toBe(409);
	const db = await mf.getD1Database("DB");
	const row = await db
		.prepare("SELECT payload FROM parser_jobs WHERE id = ?")
		.bind(body.id)
		.first<{ payload: string }>();
	expect(row!.payload).not.toContain("private-parser-key");
	expect(
		await (await request(`/api/parser/jobs/${body.id}`)).json(),
	).toMatchObject({ state: "running" });
	ready = true;
	const status = await request(`/api/parser/jobs/${body.id}`);
	expect(await status.text()).not.toContain("signature");
	const result = await request(`/api/parser/jobs/${body.id}/result`);
	expect(result.status).toBe(200);
	expect(parsePaddleResult(await result.json())).toMatchObject({
		markdown: "# Parsed paper",
		pages: [{ widthPx: 1200, heightPx: 1600 }],
	});
	const previous = calls.length;
	await request(`/api/parser/jobs/${body.id}/result`);
	expect(calls).toHaveLength(previous);
	expect(
		calls
			.find((c) => c.url.hostname === "paddle-result.test")!
			.headers.has("authorization"),
	).toBe(false);
});
it("uses MinerU presigned upload, language/OCR options, page boxes and image assets", async () => {
	scenario = "mineru";
	ready = true;
	calls.length = 0;
	const body = {
		...input("mineru"),
		baseUrl: "https://mineru.test",
		language: "en",
		isOcr: true,
	};
	expect((await request("/api/parser/jobs", body)).status).toBe(200);
	expect(calls[0].body).toMatchObject({
		files: [{ name: "paper.pdf", is_ocr: true }],
		language: "en",
		model_version: "vlm",
	});
	expect(calls[1].headers.has("authorization")).toBe(false);
	expect(calls[1].headers.has("content-type")).toBe(false);
	await request(`/api/parser/jobs/${body.id}`);
	const result = parseMineruResult(
		new Uint8Array(
			await (await request(`/api/parser/jobs/${body.id}/result`)).arrayBuffer(),
		),
	);
	expect(result.pages[0].boxes[0].coordinate).toEqual([60, 160, 300, 480]);
	expect(result.assets[0].path).toBe("images/a.png");
	expect(() =>
		parseMineruResult(zipSync({ "../escape.md": strToU8("escape") })),
	).toThrow();
});
it("does not repeat uncertain billable submissions or expose upstream errors", async () => {
	scenario = "broken";
	calls.length = 0;
	const body = input("paddle");
	const result = await request("/api/parser/jobs", body);
	expect(result.status).toBe(502);
	expect(await result.text()).not.toContain("credential");
	const retried = await request("/api/parser/jobs", body);
	expect(await retried.json()).toMatchObject({ state: "uncertain" });
	expect(calls).toHaveLength(1);
});
it("tests actual configured endpoints and sends custom OCR model/prompt with the correct image MIME", async () => {
	scenario = "ocr";
	calls.length = 0;
	const config = {
		provider: "openaiCompatible",
		baseUrl: "https://vlm.test/v1",
		apiKey: "private-ocr-key",
		model: "ocr-model",
		prompt: "Keep tables",
		imageBase64: btoa("image"),
		mimeType: "image/png",
	};
	expect((await request("/api/parser/probe", config)).status).toBe(200);
	expect(calls[0].url.pathname).toBe("/v1/models");
	expect(await (await request("/api/parser/ocr", config)).json()).toEqual({
		text: "transcribed",
	});
	const body = calls[1].body as {
		model: string;
		messages: Array<{
			content: Array<{
				type: string;
				image_url?: { url: string };
				text?: string;
			}>;
		}>;
	};
	expect(body.model).toBe("ocr-model");
	expect(JSON.stringify(body)).toContain("Keep tables");
	expect(JSON.stringify(body)).toContain("data:image/png;base64,");
	expect(
		(
			await request("/api/parser/probe", {
				...config,
				baseUrl: "https://127.0.0.1",
			})
		).status,
	).toBe(400);
	expect((await mf.dispatchFetch(origin + "/api/parser/probe")).status).toBe(
		401,
	);
});
it.each([
	"openai",
	"anthropic",
])("tests the actual %s model using a short response without saving draft credentials", async (provider) => {
	scenario = "ocr";
	calls.length = 0;
	expect(
		(
			await request("/api/ai/probe", {
				provider,
				baseUrl: "https://models.test/v1",
				apiKey: "draft-key",
				model: "draft-model",
			})
		).status,
	).toBe(200);
	expect(calls[0].url.pathname).toBe(
		provider === "anthropic" ? "/v1/messages" : "/v1/chat/completions",
	);
	expect(calls[0].body).toMatchObject({
		model: "draft-model",
		max_tokens: 16,
		stream: false,
	});
	const db = await mf.getD1Database("DB");
	expect(await db.prepare("SELECT value FROM config").first()).toBeNull();
});

it("never sends a saved model key to a different draft endpoint", async () => {
	const config = {
		provider: "openai",
		baseUrl: "https://models.test/v1",
		model: "model",
		apiKey: "saved-model-secret",
	};
	const saved = await mf.dispatchFetch(origin + "/api/ai/config", {
		method: "PUT",
		headers: { cookie, origin, "content-type": "application/json" },
		body: JSON.stringify(config),
	});
	expect(saved.status).toBe(200);
	calls.length = 0;
	const { apiKey: _, ...draft } = config;
	expect(
		(
			await request("/api/ai/probe", {
				...draft,
				baseUrl: "https://different.test/v1",
			})
		).status,
	).toBe(409);
	expect(calls).toHaveLength(0);
	expect((await request("/api/ai/probe", draft)).status).toBe(200);
	expect(calls[0].headers.get("authorization")).toBe(
		"Bearer saved-model-secret",
	);
});
