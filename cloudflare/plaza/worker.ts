import { readBytes } from "../http";
import { type PlazaGrant, verifyPlazaGrant } from "./auth";
import { COOLPAPERS_LIVE_BRIDGE, MODELSCOPE_LIVE_BRIDGE } from "./bridges";

export type PlazaProxyEnv = {
	ENCRYPTION_KEY: string;
	APP_ORIGIN: string;
	SITE: "coolpapers" | "modelscope";
};
const COOKIE = "agentero_plaza";
const upstreamOrigins = {
	coolpapers: "https://papers.cool",
	modelscope: "https://modelscope.cn",
};

export function rewritePlazaHtml(
	html: string,
	proxy: string,
	upstream: string,
	grant: PlazaGrant,
): string {
	const data = JSON.stringify({
		parentOrigin: grant.parent,
		importLabel: grant.labels.import,
		importPending: grant.labels.pending,
		importDone: grant.labels.done,
	}).replaceAll("<", "\\u003c");
	const setup = `<script>Object.assign(document.documentElement.dataset,${data});</script>`;
	const bridge =
		grant.site === "coolpapers"
			? COOLPAPERS_LIVE_BRIDGE
			: MODELSCOPE_LIVE_BRIDGE;
	const rewritten = html
		.replaceAll(upstream, proxy)
		.replace(/(\s(?:src|href)\s*=\s*["'])\/\//gi, "$1https://")
		.replace(/=\s*(["'])\/\//g, "=$1https://")
		.replace(/target=(["'])_blank\1/gi, 'target="_self"');
	return /<head(?:\s[^>]*)?>/i.test(rewritten)
		? rewritten.replace(
				/<head(?:\s[^>]*)?>/i,
				(head) => `${head}${setup}${bridge}`,
			)
		: `${setup}${bridge}${rewritten}`;
}
function responseHeaders(parent: string) {
	return {
		"cache-control": "no-store",
		"referrer-policy": "no-referrer",
		"content-security-policy": `frame-ancestors ${parent}; object-src 'none'`,
		"x-content-type-options": "nosniff",
	};
}
function proxyError(parent: string, status: number, errorCode: string) {
	const message = JSON.stringify({
		source: "agentero-plaza",
		errorCode,
	}).replaceAll("<", "\\u003c");
	const origin = JSON.stringify(parent).replaceAll("<", "\\u003c");
	return new Response(
		`<!doctype html><script>parent.postMessage(${message},${origin})</script>`,
		{
			status,
			headers: {
				...responseHeaders(parent),
				"content-type": "text/html; charset=utf-8",
			},
		},
	);
}
async function handle(request: Request, env: PlazaProxyEnv): Promise<Response> {
	const url = new URL(request.url);
	if (
		!Object.hasOwn(upstreamOrigins, env.SITE) ||
		new URL(env.APP_ORIGIN).origin !== env.APP_ORIGIN ||
		env.APP_ORIGIN === url.origin
	)
		return new Response("Invalid proxy configuration", { status: 503 });
	const bootstrap = url.pathname === "/_agentero/auth";
	const token = bootstrap
		? url.searchParams.get("grant")
		: request.headers
				.get("cookie")
				?.split(";")
				.map((part) => part.trim())
				.find((part) => part.startsWith(`${COOKIE}=`))
				?.slice(COOKIE.length + 1);
	const grant = token
		? await verifyPlazaGrant(token, env.ENCRYPTION_KEY)
		: null;
	if (
		!grant ||
		grant.site !== env.SITE ||
		grant.proxy !== url.origin ||
		grant.parent !== env.APP_ORIGIN
	)
		return proxyError(env.APP_ORIGIN, 401, "unauthorized");
	if (bootstrap) {
		const path = url.searchParams.get("path") || "/";
		const destination = new URL(path, url.origin);
		if (
			request.method !== "GET" ||
			destination.origin !== url.origin ||
			destination.username ||
			destination.password ||
			destination.pathname.startsWith("/_agentero/")
		)
			return new Response("Invalid navigation", { status: 400 });
		const secure =
			url.protocol === "https:"
				? "; Secure; SameSite=None; Partitioned"
				: "; SameSite=Lax";
		return new Response(null, {
			status: 303,
			headers: {
				...responseHeaders(grant.parent),
				location: destination.href,
				"set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Max-Age=${Math.max(0, Math.floor((grant.expires - Date.now()) / 1000))}${secure}`,
			},
		});
	}
	if (
		url.pathname.startsWith("/_agentero/") ||
		request.headers.has("service-worker")
	)
		return new Response("Not available", { status: 403 });
	if (
		["POST", "PUT"].includes(request.method) &&
		request.headers.get("origin") !== url.origin
	)
		return new Response(null, { status: 403 });
	if (!["GET", "HEAD", "POST", "PUT"].includes(request.method))
		return new Response("Method not allowed", { status: 405 });
	// All server-side requests stay on the selected fixed upstream, including // paths and redirects.
	const upstream = upstreamOrigins[env.SITE];
	const target = new URL(upstream);
	target.pathname = url.pathname;
	target.search = url.search;
	const headers = new Headers({
		"user-agent": "Lattiora (+https://github.com/Weifeng2Wu/Lattiora)",
	});
	for (const name of [
		"accept",
		"accept-language",
		"content-type",
		"range",
		"if-none-match",
		"if-modified-since",
	]) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}
	const cookies = request.headers
		.get("cookie")
		?.split(";")
		.filter((part) => !part.trim().startsWith(`${COOKIE}=`))
		.join(";");
	if (cookies) headers.set("cookie", cookies);
	if (["POST", "PUT"].includes(request.method)) headers.set("origin", upstream);
	headers.set("referer", `${upstream}${url.pathname}`);
	const body = ["POST", "PUT"].includes(request.method)
		? await readBytes(request, 64 * 1024)
		: undefined;
	const result = await fetch(target, {
		method: request.method,
		headers,
		body,
		redirect: "manual",
		signal: AbortSignal.any([request.signal, AbortSignal.timeout(180_000)]),
	});
	const outgoing = new Headers(result.headers);
	for (const name of [
		"content-security-policy",
		"content-security-policy-report-only",
		"x-frame-options",
		"access-control-allow-origin",
		"access-control-allow-credentials",
		"clear-site-data",
		"service-worker-allowed",
	])
		outgoing.delete(name);
	for (const [name, value] of Object.entries(responseHeaders(grant.parent)))
		outgoing.set(name, value);
	outgoing.delete("set-cookie");
	for (const cookie of result.headers.getSetCookie()) {
		if (cookie.trim().startsWith(`${COOKIE}=`)) continue;
		outgoing.append("set-cookie", cookie.replace(/;\s*domain=[^;]*/gi, ""));
	}
	const location = result.headers.get("location");
	if (location) {
		const next = new URL(location, target);
		if (next.origin === upstream)
			outgoing.set(
				"location",
				`${url.origin}${next.pathname}${next.search}${next.hash}`,
			);
	}
	const type = result.headers.get("content-type") || "";
	if (
		request.method !== "HEAD" &&
		result.status === 200 &&
		/(?:text\/html|(?:java|ecma)script)/i.test(type)
	) {
		const raw = new TextDecoder().decode(
			await readBytes(result, 12 * 1024 * 1024),
		);
		const text = /text\/html/i.test(type)
			? rewritePlazaHtml(raw, url.origin, upstream, grant)
			: raw.replaceAll(upstream, url.origin);
		for (const header of [
			"content-length",
			"content-encoding",
			"etag",
			"content-md5",
		])
			outgoing.delete(header);
		return new Response(text, { status: result.status, headers: outgoing });
	}
	return new Response(result.body, {
		status: result.status,
		headers: outgoing,
	});
}
export default {
	async fetch(request: Request, env: PlazaProxyEnv): Promise<Response> {
		try {
			return await handle(request, env);
		} catch {
			return proxyError(env.APP_ORIGIN, 502, "requestFailed");
		}
	},
};
