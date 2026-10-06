import {
	isNoteShareSnapshot,
	MAX_SHARE_BYTES,
	NOTE_SHARE_MIME,
	SHARE_MIME,
	type ShareFormat,
	type ShareInfo,
} from "../src/lib/cloud/share-protocol";
import { HttpError, json, readBytes, readJson } from "./http";
import { sameSecret } from "./security";
import type { Env } from "./worker";

type ShareRow = {
	id: string;
	source_path: string;
	title: string;
	format: ShareFormat;
	key_hash: string | null;
	created_at: number;
	expires_at: number | null;
	revoked_at: number | null;
};
const ID = /^[a-f0-9]{32}$/;
const blobKey = (id: string) => `shares/${id}`;
function info(row: ShareRow): ShareInfo {
	return {
		id: row.id,
		sourcePath: row.source_path,
		title: row.title,
		format: row.format,
		hasKey: Boolean(row.key_hash),
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		revokedAt: row.revoked_at,
	};
}
async function find(env: Env, id: string) {
	return env.DB.prepare("SELECT * FROM shares WHERE id = ?")
		.bind(id)
		.first<ShareRow>();
}
function requireActive(row: ShareRow | null): asserts row is ShareRow {
	if (
		!row ||
		row.revoked_at !== null ||
		(row.expires_at !== null && row.expires_at <= Date.now())
	)
		throw new HttpError(404, "shareUnavailable");
}
async function hashKey(key: string, salt: string): Promise<string> {
	const encoder = new TextEncoder();
	const material = await crypto.subtle.importKey(
		"raw",
		encoder.encode(key),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bytes = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			hash: "SHA-256",
			salt: encoder.encode(salt),
			iterations: 100000,
		},
		material,
		256,
	);
	return [...new Uint8Array(bytes)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

/** Public access is deliberately separate from authenticated workspace APIs. */
export async function publicShareRoutes(
	request: Request,
	env: Env,
): Promise<Response | null> {
	const match = /^\/api\/public-shares\/([a-f0-9]{32})$/.exec(
		new URL(request.url).pathname,
	);
	if (!match) return null;
	if (request.method !== "GET" && request.method !== "POST")
		throw new HttpError(405, "methodNotAllowed");
	const row = await find(env, match[1]);
	requireActive(row);
	if (request.method === "GET")
		return json({ hasKey: Boolean(row.key_hash), expiresAt: row.expires_at });
	const input = (await readJson(request, 1024)) as { key?: unknown } | null;
	if (row.key_hash) {
		const allowed = await env.LOGIN_LIMIT.limit({
			key: `share:${request.headers.get("cf-connecting-ip") ?? "local"}`,
		});
		if (!allowed.success) throw new HttpError(429, "tryLater");
		if (
			!input ||
			typeof input.key !== "string" ||
			input.key.length > 128 ||
			!(await sameSecret(await hashKey(input.key, row.id), row.key_hash))
		)
			throw new HttpError(403, "invalidShareKey");
	}
	const blob = await env.FILES.get(blobKey(row.id));
	if (!blob) throw new HttpError(404, "shareUnavailable");
	// A revoke or expiry during password verification / R2 access also takes effect.
	requireActive(await find(env, row.id));
	return new Response(blob.body, {
		headers: {
			"content-type":
				blob.httpMetadata?.contentType === NOTE_SHARE_MIME
					? NOTE_SHARE_MIME
					: SHARE_MIME[row.format],
			"content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${row.title}.${row.format}`).replace(/'/g, "%27")}`,
			"x-share-title": encodeURIComponent(row.title),
			"x-share-format": row.format,
			"content-security-policy": "default-src 'none'; sandbox",
		},
	});
}

/** Called only after the Worker's session and Origin checks. */
export async function shareRoutes(
	request: Request,
	env: Env,
): Promise<Response | null> {
	const url = new URL(request.url);
	if (url.pathname === "/api/shares" && request.method === "GET") {
		const path = url.searchParams.get("path");
		const query =
			path === null
				? env.DB.prepare(
						"SELECT * FROM shares WHERE revoked_at IS NULL ORDER BY created_at DESC",
					)
				: env.DB.prepare(
						"SELECT * FROM shares WHERE source_path = ? AND revoked_at IS NULL ORDER BY created_at DESC",
					).bind(path);
		return json((await query.all<ShareRow>()).results.map(info));
	}
	const match = /^\/api\/shares\/([^/]+)$/.exec(url.pathname);
	if (!match) return null;
	const id = match[1];
	if (!ID.test(id)) throw new HttpError(400, "invalidShare");
	if (request.method === "DELETE") {
		if (!(await find(env, id))) throw new HttpError(404, "shareUnavailable");
		await env.DB.prepare(
			"UPDATE shares SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?",
		)
			.bind(Date.now(), id)
			.run();
		await env.FILES.delete(blobKey(id));
		return json({ ok: true });
	}
	if (request.method !== "PUT") throw new HttpError(405, "methodNotAllowed");
	const bytes = await readBytes(request, MAX_SHARE_BYTES + 16 * 1024);
	let form: FormData;
	try {
		form = await new Response(bytes, {
			headers: { "content-type": request.headers.get("content-type") ?? "" },
		}).formData();
	} catch {
		throw new HttpError(400, "invalidShare");
	}
	const metadata = form.get("metadata");
	const file = form.get("file");
	if (
		typeof metadata !== "string" ||
		metadata.length > 4096 ||
		!file ||
		typeof file === "string"
	)
		throw new HttpError(400, "invalidShare");
	if (file.size > MAX_SHARE_BYTES) throw new HttpError(413, "shareTooLarge");
	let input: {
		title?: unknown;
		sourcePath?: unknown;
		format?: unknown;
		key?: unknown;
		expiresAt?: unknown;
		snapshot?: unknown;
	};
	try {
		input = JSON.parse(metadata);
	} catch {
		throw new HttpError(400, "invalidShare");
	}
	if (
		!input ||
		typeof input.title !== "string" ||
		!input.title.trim() ||
		input.title.length > 240 ||
		typeof input.sourcePath !== "string" ||
		!input.sourcePath ||
		input.sourcePath.length > 1024 ||
		(input.format !== "pdf" &&
			input.format !== "png" &&
			input.format !== "md") ||
		(input.key !== null &&
			(typeof input.key !== "string" ||
				input.key.length < 4 ||
				input.key.length > 128)) ||
		(input.expiresAt !== null &&
			(typeof input.expiresAt !== "number" ||
				!Number.isSafeInteger(input.expiresAt) ||
				input.expiresAt <= Date.now()))
	)
		throw new HttpError(400, "invalidShare");
	if (input.snapshot !== undefined && input.snapshot !== true)
		throw new HttpError(400, "invalidShare");
	if (input.snapshot) {
		let snapshot: unknown;
		try {
			snapshot = JSON.parse(await file.text());
		} catch {
			throw new HttpError(400, "invalidShare");
		}
		if (input.format !== "md" || !isNoteShareSnapshot(snapshot))
			throw new HttpError(400, "invalidShare");
	}
	if (await find(env, id)) throw new HttpError(409, "shareExists");
	const row: ShareRow = {
		id,
		source_path: input.sourcePath,
		title: input.title.trim(),
		format: input.format,
		key_hash:
			input.key === null ? null : await hashKey(input.key as string, id),
		created_at: Date.now(),
		expires_at: input.expiresAt as number | null,
		revoked_at: null,
	};
	// Immutable R2 write: concurrent duplicate IDs must never replace a published snapshot.
	const uploaded = await env.FILES.put(blobKey(id), file.stream(), {
		onlyIf: { etagDoesNotMatch: "*" },
		httpMetadata: {
			contentType: input.snapshot ? NOTE_SHARE_MIME : SHARE_MIME[row.format],
		},
	});
	if (!uploaded) throw new HttpError(409, "shareExists");
	try {
		await env.DB.prepare(
			"INSERT INTO shares (id, source_path, title, format, key_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		)
			.bind(
				id,
				row.source_path,
				row.title,
				row.format,
				row.key_hash,
				row.created_at,
				row.expires_at,
			)
			.run();
	} catch (error) {
		await env.FILES.delete(blobKey(id));
		throw error;
	}
	return json(info(row), 201);
}
