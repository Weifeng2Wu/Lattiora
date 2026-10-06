import { z } from "zod";
import {
	MAX_FILE_BYTES,
	MAX_TEXT_BYTES,
	validPath,
} from "../src/lib/cloud/protocol";
import { HttpError, json, readBytes, readJson } from "./http";

export type StorageEnv = { DB: D1Database; FILES: R2Bucket };
const META = "path, version, seq, mutation_id, deleted, mime, size, updated_at";
const mutationId = z.string().uuid();
const writeSchema = z
	.object({
		path: z.string().refine(validPath),
		version: z
			.number()
			.int()
			.min(0)
			.max(Number.MAX_SAFE_INTEGER - 1),
		mutation_id: mutationId,
		deleted: z.boolean(),
		content: z.string().nullable(),
		blob_key: mutationId.nullable(),
		mime: z
			.string()
			.min(1)
			.max(100)
			.regex(/^[\w.+-]+\/[\w.+-]+$/),
	})
	.strict();

async function sha256(bytes: Uint8Array): Promise<string> {
	return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

async function receipt(
	env: StorageEnv,
	id: string,
	hash: string,
): Promise<Response | null> {
	const old = await env.DB.prepare(
		"SELECT request_hash, result FROM mutation_receipts WHERE mutation_id = ?",
	)
		.bind(id)
		.first<{ request_hash: string; result: string }>();
	if (!old) return null;
	if (old.request_hash !== hash) throw new HttpError(409, "mutationReused");
	return json(JSON.parse(old.result));
}

export async function fileRoutes(
	request: Request,
	env: StorageEnv,
): Promise<Response | null> {
	const url = new URL(request.url);
	if (url.pathname === "/api/changes" && request.method === "GET") {
		const after = Number(url.searchParams.get("after") ?? "0");
		if (!Number.isSafeInteger(after) || after < 0)
			throw new HttpError(400, "invalidCursor");
		const { results } = await env.DB.prepare(
			`SELECT ${META} FROM files WHERE seq > ? ORDER BY seq LIMIT 100`,
		)
			.bind(after)
			.all();
		return json({
			files: results,
			cursor: results.length ? results[results.length - 1].seq : after,
			more: results.length === 100,
		});
	}
	if (url.pathname.startsWith("/api/blobs/") && request.method === "PUT") {
		const id = mutationId.safeParse(url.pathname.slice("/api/blobs/".length));
		if (!id.success) throw new HttpError(400, "invalidBlobId");
		const bytes = await readBytes(request, MAX_FILE_BYTES);
		const hash = await sha256(bytes);
		// A retry must never replace bytes already referenced by a D1 revision.
		const saved = await env.FILES.put(`files/${id.data}`, bytes, {
			onlyIf: { etagDoesNotMatch: "*" },
			customMetadata: { sha256: hash },
		});
		if (!saved) {
			const existing = await env.FILES.head(`files/${id.data}`);
			if (!existing || existing.customMetadata?.sha256 !== hash)
				throw new HttpError(409, "blobExists");
		}
		return json({ key: id.data, size: bytes.byteLength });
	}
	if (url.pathname !== "/api/file") return null;
	if (request.method === "GET") {
		const path = url.searchParams.get("path");
		if (!validPath(path)) throw new HttpError(400, "invalidPath");
		const file = await env.DB.prepare("SELECT * FROM files WHERE path = ?")
			.bind(path)
			.first<{
				deleted: number;
				version: number;
				content: string | null;
				blob_key: string | null;
				mime: string;
			}>();
		if (!file || file.deleted) throw new HttpError(404, "notFound");
		const version = url.searchParams.get("version");
		if (version !== null && String(file.version) !== version)
			throw new HttpError(409, "versionChanged");
		const headers = new Headers({
			"content-type": file.mime,
			etag: `"${file.version}"`,
			"content-disposition": "attachment",
			// User HTML/SVG must never execute with the application origin.
			"content-security-policy": "sandbox",
		});
		if (file.blob_key) {
			const object = await env.FILES.get(`files/${file.blob_key}`);
			if (!object) throw new HttpError(503, "missingBlob");
			headers.set("content-length", String(object.size));
			return new Response(object.body, { headers });
		}
		return new Response(file.content ?? "", { headers });
	}
	if (request.method !== "PUT") return null;
	const parsed = writeSchema.safeParse(
		await readJson(request, MAX_TEXT_BYTES * 6 + 2048),
	);
	if (!parsed.success) throw new HttpError(400, "invalidFile");
	const write = parsed.data;
	if (!write.deleted && (write.content === null) === (write.blob_key === null))
		throw new HttpError(400, "invalidFile");
	if (write.deleted && (write.content !== null || write.blob_key !== null))
		throw new HttpError(400, "invalidFile");
	const hash = await sha256(new TextEncoder().encode(JSON.stringify(write)));
	const previous = await receipt(env, write.mutation_id, hash);
	if (previous) return previous;
	let size = 0;
	if (write.content !== null) {
		size = new TextEncoder().encode(write.content).byteLength;
		if (size > MAX_TEXT_BYTES) throw new HttpError(413, "tooLarge");
	}
	if (write.blob_key) {
		const blob = await env.FILES.head(`files/${write.blob_key}`);
		if (!blob) throw new HttpError(400, "missingBlob");
		size = blob.size;
		if (size > MAX_FILE_BYTES) throw new HttpError(413, "tooLarge");
	}
	// All conditions run inside one D1 transaction; no read/check/write race.
	// Receipts make a response lost in transit safe to retry even after a newer
	// edit. Failed CAS attempts may leave harmless gaps in the change clock.
	await env.DB.batch([
		env.DB.prepare("UPDATE clock SET value = value + 1 WHERE id = 1"),
		env.DB.prepare(`INSERT INTO files (${META}, content, blob_key)
			SELECT ?, 1, (SELECT value FROM clock WHERE id = 1), ?, ?, ?, ?, ?, ?, ?
			WHERE (? = 0 OR EXISTS (SELECT 1 FROM files WHERE path = ?))
			AND NOT EXISTS (SELECT 1 FROM mutation_receipts WHERE mutation_id = ?)
			ON CONFLICT(path) DO UPDATE SET version = files.version + 1,
			seq = excluded.seq, mutation_id = excluded.mutation_id, deleted = excluded.deleted,
			mime = excluded.mime, size = excluded.size, updated_at = excluded.updated_at,
			content = excluded.content, blob_key = excluded.blob_key
			WHERE files.version = ?`).bind(
			write.path,
			write.mutation_id,
			Number(write.deleted),
			write.mime,
			size,
			Date.now(),
			write.content,
			write.blob_key,
			write.version,
			write.path,
			write.mutation_id,
			write.version,
		),
		env.DB.prepare(`INSERT OR IGNORE INTO mutation_receipts (mutation_id, request_hash, result)
			SELECT mutation_id, ?, json_object('path', path, 'version', version, 'seq', seq,
				'mutation_id', mutation_id, 'deleted', deleted, 'mime', mime, 'size', size, 'updated_at', updated_at)
			FROM files WHERE path = ? AND mutation_id = ? AND version = ?`).bind(
			hash,
			write.path,
			write.mutation_id,
			write.version + 1,
		),
	]);
	const acknowledged = await receipt(env, write.mutation_id, hash);
	if (acknowledged) return acknowledged;
	const current = await env.DB.prepare(
		`SELECT ${META} FROM files WHERE path = ?`,
	)
		.bind(write.path)
		.first();
	return json({ error: "conflict", current }, 409);
}
