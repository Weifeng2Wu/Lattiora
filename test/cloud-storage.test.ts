import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { IDBFactory } from "fake-indexeddb";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let mf: Miniflare;
let cookie: string;
const providerCalls: Array<{
	path: string;
	headers: Headers;
	body: Record<string, unknown>;
}> = [];
const origin = "https://workspace.test";
const password = "local-testing-password-more-than-32-characters";
async function request(
	path: string,
	body?: unknown,
	method = body === undefined ? "GET" : "PUT",
) {
	return mf.dispatchFetch(origin + path, {
		method,
		headers: { origin, cookie, "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}
function mutation(path: string, content: string | null, version = 0) {
	return {
		path,
		version,
		mutation_id: crypto.randomUUID(),
		deleted: content === null,
		content,
		blob_key: null,
		mime: "text/markdown",
	};
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
			bindings: { ACCESS_PASSWORD: password, ENCRYPTION_KEY: "ab".repeat(32) },
			ratelimits: {
				LOGIN_LIMIT: {
					namespace_id: "1001",
					simple: { limit: 1000, period: 60 },
				},
			},
			outboundService: async (request) => {
				const path = new URL(request.url).pathname;
				providerCalls.push({
					path,
					headers: new Headers(request.headers),
					body: (await request.json()) as Record<string, unknown>,
				});
				const body = path.endsWith("/messages")
					? 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"协议验证"}}\n\ndata: {"type":"message_stop"}\n\n'
					: 'data: {"choices":[{"delta":{"content":"协议验证"}}]}\n\ndata: [DONE]\n\n';
				return new Response(body, {
					headers: { "content-type": "text/event-stream" },
				});
			},
		}),
	);
	const db = await mf.getD1Database("DB");
	for (const name of ["0001_workspace.sql", "0002_mutation_receipts.sql"]) {
		const sql = await readFile(`cloudflare/migrations/${name}`, "utf8");
		await db.exec(sql.replace(/--[^\n]*/g, "").replace(/\n/g, " "));
	}
	const response = await mf.dispatchFetch(origin + "/api/session", {
		method: "POST",
		headers: { origin, "content-type": "application/json" },
		body: JSON.stringify({ password }),
	});
	expect(response.status).toBe(200);
	cookie = response.headers.get("set-cookie")!.split(";")[0];
}, 30_000);
afterAll(async () => {
	vi.unstubAllGlobals();
	await mf?.dispose();
});

describe("real workerd / D1 / R2 storage", () => {
	it("requires authentication and same-origin mutations; never caches user data", async () => {
		expect((await mf.dispatchFetch(origin + "/api/changes")).status).toBe(401);
		expect(
			(
				await mf.dispatchFetch(origin + "/api/file", {
					method: "PUT",
					headers: { cookie, origin: "https://attacker.test" },
					body: "{}",
				})
			).status,
		).toBe(403);
		const response = await request("/api/changes");
		expect(response.headers.get("cache-control")).toBe("no-store");
	});
	it("atomically chooses one concurrent writer and retains retry receipts beyond newer revisions", async () => {
		const a = mutation("notes/race.md", "device A");
		const b = mutation(a.path, "device B");
		const replies = await Promise.all([
			request("/api/file", a),
			request("/api/file", b),
		]);
		expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
		const accepted = replies[0].status === 200 ? a : b;
		const latest = await request("/api/file", mutation(a.path, "new edit", 1));
		expect(latest.status).toBe(200);
		const retry = await request("/api/file", accepted);
		expect(retry.status).toBe(200);
		expect(await retry.json()).toMatchObject({ version: 1 });
		expect(await (await request(`/api/file?path=${a.path}`)).text()).toBe(
			"new edit",
		);
		expect(
			(await request("/api/file", { ...accepted, content: "changed request" }))
				.status,
		).toBe(409);
	});
	it("propagates tombstones and rejects stale resurrection and nonexistent base versions", async () => {
		const path = "notes/delete.md";
		expect((await request("/api/file", mutation(path, "content"))).status).toBe(
			200,
		);
		expect((await request("/api/file", mutation(path, null, 1))).status).toBe(
			200,
		);
		expect(
			(await request("/api/file", mutation(path, "stale", 1))).status,
		).toBe(409);
		expect((await request(`/api/file?path=${path}`)).status).toBe(404);
		const batch = (await (await request("/api/changes")).json()) as {
			files: Array<{ path: string; deleted: number }>;
		};
		expect(batch.files.find((f) => f.path === path)?.deleted).toBe(1);
		expect(
			(await request("/api/file", mutation("notes/absent.md", "data", 99)))
				.status,
		).toBe(409);
	});
	it("keeps R2 blobs immutable and checks revision before serving bytes", async () => {
		const id = crypto.randomUUID();
		const put = (body: string) =>
			mf.dispatchFetch(`${origin}/api/blobs/${id}`, {
				method: "PUT",
				headers: { origin, cookie },
				body,
			});
		expect((await put("PDF bytes")).status).toBe(200);
		expect((await put("PDF bytes")).status).toBe(200);
		expect((await put("different bytes")).status).toBe(409);
		const file = {
			...mutation("papers/file.pdf", ""),
			content: null,
			mime: "application/pdf",
			blob_key: id,
		};
		expect((await request("/api/file", file)).status).toBe(200);
		expect(
			await (await request("/api/file?path=papers/file.pdf&version=1")).text(),
		).toBe("PDF bytes");
		expect(
			(await request("/api/file?path=papers/file.pdf&version=2")).status,
		).toBe(409);
	});
	it("never returns or stores plaintext provider credentials", async () => {
		const config = {
			provider: "anthropic",
			baseUrl: "https://api.anthropic.com/v1",
			model: "fixture-model",
			apiKey: "secret-fixture-key",
		};
		expect((await request("/api/ai/config", config)).status).toBe(200);
		const response = await (await request("/api/ai/config")).json();
		expect(response).toEqual({
			provider: config.provider,
			baseUrl: config.baseUrl,
			model: config.model,
			hasKey: true,
		});
		const db = await mf.getD1Database("DB");
		const row = await db
			.prepare("SELECT value FROM config")
			.first<{ value: string }>();
		expect(row!.value).not.toContain(config.apiKey);
		expect(
			(
				await request("/api/ai/config", {
					...config,
					baseUrl: "https://new.example.com/v1",
					apiKey: "",
				})
			).status,
		).toBe(400);
	});
	it("runs chat, translation and vision requests through both provider protocols", async () => {
		for (const provider of ["openai", "anthropic"]) {
			const config = {
				provider,
				baseUrl: "https://fixture.example.com/custom",
				model: "fixture-model",
				apiKey: "fixture-key",
			};
			expect((await request("/api/ai/config", config)).status).toBe(200);
			const chat = await request(
				"/api/ai/chat",
				{
					messages: [{ role: "user", content: "Summarize" }],
					context: "source document",
				},
				"POST",
			);
			expect(
				chat.status,
				JSON.stringify({
					body: await chat.clone().text(),
					calls: providerCalls.map((call) => call.path),
				}),
			).toBe(200);
			const output = await chat.text();
			expect(output).toContain('"text":"协议验证"');
			expect(output).toContain('"type":"done"');
			const translated = await request(
				"/api/ai/translate",
				{ text: "document", targetLang: "zh-CN" },
				"POST",
			);
			expect(await translated.json()).toEqual({ text: "协议验证" });
			const ocr = await request(
				"/api/ai/ocr",
				{ image: "data:image/png;base64,aGVsbG8=" },
				"POST",
			);
			expect(await ocr.json()).toEqual({ text: "协议验证" });
			const call = providerCalls.at(-1)!;
			expect(call.path).toBe(
				provider === "anthropic"
					? "/custom/messages"
					: "/custom/chat/completions",
			);
			expect(
				call.headers.get(
					provider === "anthropic" ? "x-api-key" : "authorization",
				),
			).toBe(provider === "anthropic" ? "fixture-key" : "Bearer fixture-key");
			expect(call.body.model).toBe("fixture-model");
		}
	});
});

async function device() {
	vi.resetModules();
	const indexedDB = new IDBFactory();
	const storage = new Map<string, string>();
	const localStorage = {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
	};
	const use = () => {
		vi.stubGlobal("indexedDB", indexedDB);
		vi.stubGlobal("localStorage", localStorage);
	};
	use();
	vi.stubGlobal("navigator", {
		onLine: true,
		locks: { request: (_name: string, callback: () => unknown) => callback() },
	});
	const files = await import("../src/lib/cloud/files");
	const sync = await import("../src/lib/cloud/sync");
	await files.listLocalFiles(); // Capture a separate IndexedDB database for this device.
	return { use, ...files, ...sync };
}

describe("offline client against real D1", () => {
	it("retains both devices' edits and propagates conflict copies", async () => {
		vi.stubGlobal("fetch", (path: string, init?: RequestInit) =>
			mf.dispatchFetch(origin + path, {
				...init,
				headers: { ...init?.headers, origin, cookie },
			}),
		);
		const a = await device();
		const b = await device();
		const path = "notes/client-conflict.md";
		a.use();
		await a.writeLocalFile(
			path,
			new Blob(["initial"], { type: "text/markdown" }),
		);
		await a.syncOnce();
		b.use();
		await b.syncOnce();
		expect(await (await b.readLocalFile(path)).text()).toBe("initial");
		a.use();
		await a.writeLocalFile(path, new Blob(["A offline edit"]));
		b.use();
		await b.writeLocalFile(path, new Blob(["B offline edit"]));
		await b.syncOnce();
		a.use();
		await a.syncOnce();
		expect(await (await a.readLocalFile(path)).text()).toBe("B offline edit");
		const conflicts = (await a.listLocalFiles()).filter(
			(f) => f.path.startsWith("Conflicts/") && f.path.endsWith(path),
		);
		expect(conflicts).toHaveLength(1);
		expect(await conflicts[0].data!.text()).toBe("A offline edit");
		await a.syncOnce();
		b.use();
		await b.syncOnce();
		expect(await (await b.readLocalFile(conflicts[0].path)).text()).toBe(
			"A offline edit",
		);
	});
	it("retries a lost acknowledgement without losing an edit made during upload", async () => {
		const a = await device();
		const path = "notes/inflight.md";
		await a.writeLocalFile(path, new Blob(["sent snapshot"]));
		let dropReply = true;
		vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
			const response = await mf.dispatchFetch(origin + url, {
				...init,
				headers: { ...init?.headers, origin, cookie },
			});
			if (url === "/api/file" && dropReply) {
				dropReply = false;
				await a.writeLocalFile(path, new Blob(["edited during upload"]));
				throw new TypeError("connection lost after commit");
			}
			return response;
		});
		await expect(a.syncOnce()).rejects.toThrow("connection lost");
		expect(await (await a.readLocalFile(path)).text()).toBe(
			"edited during upload",
		);
		await a.syncOnce();
		expect((await a.listLocalFiles()).find((f) => f.path === path)?.dirty).toBe(
			true,
		);
		await a.syncOnce();
		expect(await (await request(`/api/file?path=${path}`)).text()).toBe(
			"edited during upload",
		);
		expect((await a.listLocalFiles()).find((f) => f.path === path)?.dirty).toBe(
			false,
		);
	});
	it("automatically drains an offline deletion after retrying an older upload", async () => {
		const a = await device();
		const path = "notes/retry-then-delete.md";
		await a.writeLocalFile(path, new Blob(["created by Agent"]));
		let dropReply = true;
		vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
			const response = await mf.dispatchFetch(origin + url, {
				...init,
				headers: { ...init?.headers, origin, cookie },
			});
			if (url === "/api/file" && dropReply) {
				dropReply = false;
				throw new TypeError("connection lost after commit");
			}
			return response;
		});
		await expect(a.syncOnce()).rejects.toThrow("connection lost");
		await a.removeLocal(path); // Revert while offline; the older flight still exists.
		vi.stubGlobal("window", new EventTarget());
		vi.stubGlobal("document", new EventTarget());
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const stop = a.startSync();
		try {
			await vi.advanceTimersByTimeAsync(0);
			await vi.waitUntil(() => a.syncStore.getState().lastSync > 0);
			expect(a.syncStore.getState().pending).toBe(1);
			await vi.advanceTimersByTimeAsync(1500);
			await vi.waitUntil(() => a.syncStore.getState().pending === 0);
			expect((await request(`/api/file?path=${path}`)).status).toBe(404);
			expect(
				(await a.listLocalFiles()).find((f) => f.path === path),
			).toMatchObject({
				deleted: 1,
				dirty: false,
			});
		} finally {
			stop();
			vi.useRealTimers();
		}
	});
	it("preserves an edited file when another device deletes it", async () => {
		vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
			mf.dispatchFetch(origin + url, {
				...init,
				headers: { ...init?.headers, origin, cookie },
			}),
		);
		const a = await device();
		const path = "notes/delete-conflict.md";
		await a.writeLocalFile(path, new Blob(["initial"]));
		await a.syncOnce();
		const b = await device();
		await b.syncOnce();
		a.use();
		await a.removeLocal(path);
		await a.syncOnce();
		b.use();
		await b.writeLocalFile(path, new Blob(["offline survivor"]));
		await b.syncOnce();
		await expect(b.readLocalFile(path)).rejects.toThrow("not found");
		const copy = (await b.listLocalFiles()).find(
			(f) => f.path.startsWith("Conflicts/") && f.path.endsWith(path),
		);
		expect(await copy!.data!.text()).toBe("offline survivor");
	});
	it("retains edits and cursor on expired login and refuses an unrelated workspace", async () => {
		const a = await device();
		const path = "notes/auth.md";
		await a.writeLocalFile(path, new Blob(["unsynced private data"]));
		vi.stubGlobal("fetch", () =>
			Promise.resolve(
				new Response(JSON.stringify({ error: "signInRequired" }), {
					status: 401,
				}),
			),
		);
		await expect(a.syncOnce()).rejects.toThrow("signInRequired");
		expect((await a.listLocalFiles()).find((f) => f.path === path)?.dirty).toBe(
			true,
		);
		localStorage.setItem("agentero-cloud-workspace", "another-server");
		vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
			mf.dispatchFetch(origin + url, {
				...init,
				headers: { ...init?.headers, origin, cookie },
			}),
		);
		await expect(a.syncOnce()).rejects.toThrow("workspaceChanged");
		expect((await request(`/api/file?path=${path}`)).status).toBe(404);
	});
});
