import { readdir, readFile } from "node:fs/promises";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { session } from "../cloudflare/security";
import {
	MAX_SHARE_BYTES,
	type ShareInfo,
} from "../src/lib/cloud/share-protocol";

let mf: Miniflare;
let cookie: string;
const origin = "https://workspace.test";
const id = () => crypto.randomUUID().replaceAll("-", "");
const metadata = {
	title: "Research notes",
	sourcePath: "/cloud/notes/research.md",
	format: "md",
	key: null,
	expiresAt: null,
};
async function upload(
	shareId: string,
	options = {},
	content = "# Shared snapshot",
	headers = { origin, cookie },
) {
	const form = new FormData();
	form.set("metadata", JSON.stringify({ ...metadata, ...options }));
	form.set("file", new Blob([content]), "snapshot.md");
	const request = new Request(`${origin}/api/shares/${shareId}`, {
		method: "PUT",
		headers,
		body: form,
	});
	return mf.dispatchFetch(request.url, {
		method: "PUT",
		headers: request.headers,
		body: new Uint8Array(await request.arrayBuffer()),
	});
}
function read(shareId: string, key = "", ip = shareId) {
	return mf.dispatchFetch(`${origin}/api/public-shares/${shareId}`, {
		method: "POST",
		headers: {
			origin,
			"content-type": "application/json",
			"cf-connecting-ip": ip,
		},
		body: JSON.stringify({ key }),
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
	const password = "local-testing-password-more-than-32-characters";
	mf = new Miniflare(
		convertV4MiniflareOptions({
			modules: true,
			script: built.outputFiles[0].text,
			compatibilityDate: "2026-09-01",
			d1Databases: ["DB"],
			r2Buckets: ["FILES"],
			bindings: { ACCESS_PASSWORD: password, ENCRYPTION_KEY: "ab".repeat(32) },
			ratelimits: {
				LOGIN_LIMIT: { namespace_id: "1001", simple: { limit: 3, period: 60 } },
			},
		}),
	);
	const db = await mf.getD1Database("DB");
	for (const name of (await readdir("cloudflare/migrations")).sort()) {
		await db.exec(
			(await readFile(`cloudflare/migrations/${name}`, "utf8"))
				.replace(/--[^\n]*/g, "")
				.replace(/\n/g, " "),
		);
	}
	cookie = `agentero_session=${await session(password)}`;
}, 30000);
afterAll(async () => {
	await mf?.dispose();
});

describe("revocable export snapshots through real workerd / D1 / R2", () => {
	it("requires owner authentication and same-origin creation / revocation", async () => {
		const shareId = id();
		expect(
			(await upload(shareId, {}, "private", { origin, cookie: "" })).status,
		).toBe(401);
		expect(
			(
				await upload(shareId, {}, "private", {
					origin: "https://other.test",
					cookie,
				})
			).status,
		).toBe(403);
		expect((await mf.dispatchFetch(`${origin}/api/shares`)).status).toBe(401);
		expect((await upload(shareId)).status).toBe(201);
		expect(
			(
				await mf.dispatchFetch(`${origin}/api/shares/${shareId}`, {
					method: "DELETE",
					headers: { origin },
				})
			).status,
		).toBe(401);
		expect(
			(
				await mf.dispatchFetch(`${origin}/api/shares/${shareId}`, {
					method: "DELETE",
					headers: { origin: "https://other.test", cookie },
				})
			).status,
		).toBe(403);
		expect(
			(await mf.dispatchFetch(`${origin}/api/file?path=notes/research.md`))
				.status,
		).toBe(401);
	});
	it("serves only the selected immutable export without a login and never caches it", async () => {
		for (const [format, mime] of [
			["pdf", "application/pdf"],
			["png", "image/png"],
			["md", "text/markdown;charset=utf-8"],
		]) {
			const shareId = id();
			expect((await upload(shareId, { format })).status).toBe(201);
			const response = await read(shareId);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe(mime);
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(response.headers.get("x-content-type-options")).toBe("nosniff");
			expect(response.headers.get("referrer-policy")).toBe("no-referrer");
			expect(await response.text()).toBe("# Shared snapshot");
			expect((await upload(shareId, { format }, "Changed later")).status).toBe(
				409,
			);
			expect(await (await read(shareId)).text()).toBe("# Shared snapshot");
		}
	});
	it("hides content and title until a salted access key is verified", async () => {
		const shareId = id();
		const key = "private-access-key";
		const created = await upload(shareId, { key });
		expect(created.status).toBe(201);
		expect(await created.json()).toMatchObject({ id: shareId, hasKey: true });
		const preview = await mf.dispatchFetch(
			`${origin}/api/public-shares/${shareId}`,
		);
		expect(await preview.json()).toEqual({ hasKey: true, expiresAt: null });
		expect((await read(shareId)).status).toBe(403);
		expect((await read(shareId, "wrong-key")).status).toBe(403);
		expect(await (await read(shareId, key)).text()).toBe("# Shared snapshot");
		const row = await (await mf.getD1Database("DB"))
			.prepare("SELECT key_hash FROM shares WHERE id = ?")
			.bind(shareId)
			.first<{ key_hash: string }>();
		expect(row?.key_hash).toMatch(/^[a-f0-9]{64}$/);
		expect(row?.key_hash).not.toContain(key);
		const second = id();
		await upload(second, { key });
		const secondRow = await (await mf.getD1Database("DB"))
			.prepare("SELECT key_hash FROM shares WHERE id = ?")
			.bind(second)
			.first<{ key_hash: string }>();
		expect(secondRow?.key_hash).not.toBe(row?.key_hash);
	});
	it("rate limits key attempts across links without consuming owner login allowance", async () => {
		const first = id(),
			second = id();
		await upload(first, { key: "correct-key" });
		await upload(second, { key: "another-key" });
		for (let attempt = 0; attempt < 3; attempt++)
			expect((await read(first, "wrong", "limited-client")).status).toBe(403);
		expect((await read(second, "another-key", "limited-client")).status).toBe(
			429,
		);
	});
	it("enforces server-side expiration and revocation, deletes R2 data and prevents resurrection", async () => {
		const expiring = id();
		await upload(expiring, { expiresAt: Date.now() + 60000 });
		await (await mf.getD1Database("DB"))
			.prepare("UPDATE shares SET expires_at = ? WHERE id = ?")
			.bind(Date.now() - 1, expiring)
			.run();
		expect((await read(expiring)).status).toBe(404);
		expect(
			(await mf.dispatchFetch(`${origin}/api/public-shares/${expiring}`))
				.status,
		).toBe(404);
		const revoked = id();
		await upload(revoked, { key: "access-key" });
		for (let attempt = 0; attempt < 2; attempt++)
			expect(
				(
					await mf.dispatchFetch(`${origin}/api/shares/${revoked}`, {
						method: "DELETE",
						headers: { origin, cookie },
					})
				).status,
			).toBe(200);
		expect((await read(revoked, "access-key")).status).toBe(404);
		expect(
			await (await mf.getR2Bucket("FILES")).get(`shares/${revoked}`),
		).toBeNull();
		expect((await upload(revoked)).status).toBe(409);
	});
	it("lists shares across sessions with optional file filtering and no password hashes", async () => {
		const shareId = id();
		const sourcePath = "/cloud/notes/unique.md";
		await upload(shareId, { sourcePath, key: "access-key" });
		const list = await mf.dispatchFetch(
			`${origin}/api/shares?path=${encodeURIComponent(sourcePath)}`,
			{ headers: { cookie } },
		);
		const rows = (await list.json()) as ShareInfo[];
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ id: shareId, hasKey: true, sourcePath });
		expect(rows[0]).not.toHaveProperty("key_hash");
		const all = await mf.dispatchFetch(`${origin}/api/shares`, {
			headers: { cookie },
		});
		expect(((await all.json()) as ShareInfo[]).length).toBeGreaterThan(1);
		await mf.dispatchFetch(`${origin}/api/shares/${shareId}`, {
			method: "DELETE",
			headers: { origin, cookie },
		});
		for (const suffix of ["", `?path=${encodeURIComponent(sourcePath)}`]) {
			const remaining = await mf.dispatchFetch(
				`${origin}/api/shares${suffix}`,
				{ headers: { cookie } },
			);
			expect(
				((await remaining.json()) as ShareInfo[]).some(
					(row) => row.id === shareId,
				),
			).toBe(false);
		}
	});
	it("keeps the selected note bundle behind the same key and revocation", async () => {
		const shareId = id();
		const snapshot = JSON.stringify({
			version: 1,
			notes: [
				{ title: "Root", markdown: "[Linked](#note=1)" },
				{ title: "Linked", markdown: "Included body" },
			],
		});
		expect(
			(await upload(shareId, { snapshot: true, key: "note-key" }, snapshot))
				.status,
		).toBe(201);
		expect((await read(shareId, "wrong")).status).toBe(403);
		const response = await read(shareId, "note-key");
		expect(response.headers.get("content-type")).toBe(
			"application/vnd.agentero.note+json",
		);
		expect(await response.text()).toBe(snapshot);
		await mf.dispatchFetch(`${origin}/api/shares/${shareId}`, {
			method: "DELETE",
			headers: { origin, cookie },
		});
		expect((await read(shareId, "note-key")).status).toBe(404);
		expect(
			(await upload(id(), { snapshot: true }, "# invalid bundle")).status,
		).toBe(400);
	});
	it("rejects invalid settings, oversized uploads and foreign-origin unlocks", async () => {
		for (const options of [
			{ key: "abc" },
			{ key: "x".repeat(129) },
			{ expiresAt: Date.now() - 1 },
			{ format: "html" },
			{ title: "" },
			{ sourcePath: "" },
		])
			expect((await upload(id(), options)).status).toBe(400);
		expect(
			(await upload(id(), {}, "x".repeat(MAX_SHARE_BYTES + 1))).status,
		).toBe(413);
		expect(
			(
				await mf.dispatchFetch(`${origin}/api/public-shares/${id()}`, {
					method: "POST",
					headers: { origin: "https://other.test" },
					body: "{}",
				})
			).status,
		).toBe(403);
	});
});
