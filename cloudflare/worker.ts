import { agentRoutes } from "./agent";
import { aiRoutes } from "./ai";
import { citingRoutes } from "./citing";
import { diagnosticsRoutes } from "./diagnostics";
import { embeddingRoutes } from "./embedding";
import { feedRoutes } from "./feeds";
import { fileRoutes } from "./files";
import { HttpError, json, readJson } from "./http";
import { layoutModelRoutes } from "./layout-model";
import { parserRoutes } from "./parser";
import { plazaSession } from "./plaza/session";
import { modelProbeRoutes } from "./providers";
import { recognitionRoutes } from "./recognition";
import { referenceRoutes } from "./references";
import { researchRoutes } from "./research";
import { authenticated, sameSecret, session } from "./security";
import { settingsRoutes } from "./settings";
import { publicShareRoutes, shareRoutes } from "./shares";
import { skillRoutes } from "./skills";
import { translateRoutes } from "./translate";
import { translatorRoutes } from "./translator";
import { weatherRoutes } from "./weather";

export type Env = {
	DB: D1Database;
	FILES: R2Bucket;
	ASSETS: Fetcher;
	LOGIN_LIMIT: RateLimit;
	ACCESS_PASSWORD: string;
	ENCRYPTION_KEY: string;
	PLAZA_COOL_ORIGIN?: string;
	PLAZA_MODELSCOPE_ORIGIN?: string;
};

async function route(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	if (!url.pathname.startsWith("/api/")) {
		const asset = await env.ASSETS.fetch(request);
		if (!asset.headers.get("content-type")?.includes("text/html")) return asset;
		const response = new Response(asset.body, asset);
		const origins = [
			env.PLAZA_COOL_ORIGIN,
			env.PLAZA_MODELSCOPE_ORIGIN,
		].flatMap((value) => {
			try {
				const origin = new URL(value ?? "");
				return origin.protocol === "https:" ||
					(origin.protocol === "http:" &&
						["127.0.0.1", "localhost"].includes(origin.hostname))
					? [origin.origin]
					: [];
			} catch {
				return [];
			}
		});
		const csp = response.headers.get("content-security-policy");
		if (csp)
			response.headers.set(
				"content-security-policy",
				csp.replace(
					/frame-src[^;]*/,
					`frame-src 'self' blob: ${origins.join(" ")}`,
				),
			);
		return response;
	}
	if (
		!env.ACCESS_PASSWORD ||
		env.ACCESS_PASSWORD.length < 32 ||
		!/^[\da-f]{64}$/i.test(env.ENCRYPTION_KEY ?? "")
	)
		throw new HttpError(503, "setupRequired");
	if (
		request.method !== "GET" &&
		request.method !== "HEAD" &&
		request.headers.get("origin") !== url.origin
	)
		throw new HttpError(403, "invalidOrigin");
	if (url.pathname === "/api/session" && request.method === "POST") {
		const allowed = await env.LOGIN_LIMIT.limit({
			key: request.headers.get("cf-connecting-ip") ?? "local",
		});
		if (!allowed.success) throw new HttpError(429, "tryLater");
		const input = await readJson(request, 1024);
		const password =
			input && typeof input === "object" && "password" in input
				? input.password
				: undefined;
		if (
			typeof password !== "string" ||
			!(await sameSecret(password, env.ACCESS_PASSWORD))
		)
			throw new HttpError(401, "invalidPassword");
		const secure = url.protocol === "https:" ? "; Secure" : "";
		return json({ ok: true }, 200, {
			"set-cookie": `agentero_session=${await session(env.ACCESS_PASSWORD)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}`,
		});
	}
	const shared = await publicShareRoutes(request, env);
	if (shared) return shared;
	if (!(await authenticated(request, env.ACCESS_PASSWORD)))
		throw new HttpError(401, "signInRequired");
	const plaza = await plazaSession(request, env);
	if (plaza) return plaza;
	if (url.pathname === "/api/session") {
		if (request.method === "GET") {
			const row = await env.DB.prepare(
				"SELECT uuid FROM workspace WHERE id = 1",
			).first<{ uuid: string }>();
			if (!row) throw new HttpError(503, "migrationRequired");
			return json({ workspaceId: row.uuid });
		}
		if (request.method === "DELETE")
			return json({ ok: true }, 200, {
				"set-cookie":
					"agentero_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
			});
	}
	return (
		(await weatherRoutes(request)) ??
		(await shareRoutes(request, env)) ??
		(await referenceRoutes(request)) ??
		(await recognitionRoutes(request, env)) ??
		(await citingRoutes(request, env)) ??
		(await layoutModelRoutes(request)) ??
		(await skillRoutes(request)) ??
		(await translatorRoutes(request, env)) ??
		(await feedRoutes(request)) ??
		(await modelProbeRoutes(request, env)) ??
		(await parserRoutes(request, env)) ??
		(await diagnosticsRoutes(request, env)) ??
		(await settingsRoutes(request, env)) ??
		(await translateRoutes(request, env)) ??
		(await embeddingRoutes(request, env)) ??
		(await fileRoutes(request, env)) ??
		(await agentRoutes(request, env)) ??
		(await aiRoutes(request, env)) ??
		(await researchRoutes(request)) ??
		json({ error: "notFound" }, 404)
	);
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		let response: Response;
		try {
			response = await route(request, env);
		} catch (error) {
			// Never forward exception messages (SQL, URLs and credentials) to clients.
			response =
				error instanceof HttpError
					? json({ error: error.message }, error.status)
					: json({ error: "serverError" }, 500);
		}
		if (new URL(request.url).pathname.startsWith("/api/")) {
			const headers = new Headers(response.headers);
			headers.set("cache-control", "no-store");
			headers.set("x-content-type-options", "nosniff");
			headers.set("referrer-policy", "no-referrer");
			return new Response(response.body, { status: response.status, headers });
		}
		return response;
	},
} satisfies ExportedHandler<Env>;
