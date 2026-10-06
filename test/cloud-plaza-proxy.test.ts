import { afterEach, expect, it, vi } from "vitest";
import {
	type PlazaGrant,
	signPlazaGrant,
	verifyPlazaGrant,
} from "../cloudflare/plaza/auth";
import {
	COOLPAPERS_LIVE_BRIDGE,
	MODELSCOPE_LIVE_BRIDGE,
} from "../cloudflare/plaza/bridges";
import proxy, { rewritePlazaHtml } from "../cloudflare/plaza/worker";

const secret = "a".repeat(64);
const env = {
	ENCRYPTION_KEY: secret,
	APP_ORIGIN: "https://app.example",
	SITE: "coolpapers" as const,
};
const grant: PlazaGrant = {
	site: "coolpapers",
	parent: env.APP_ORIGIN,
	proxy: "https://cool.example",
	expires: Date.now() + 3600000,
	labels: { import: "[Import]", pending: "[Importing]", done: "[Imported]" },
};
afterEach(() => vi.unstubAllGlobals());
it("rejects anonymous, expired, wrong-site and tampered proxy sessions", async () => {
	expect(
		(await proxy.fetch(new Request("https://cool.example/"), env)).status,
	).toBe(401);
	const token = await signPlazaGrant(grant, secret);
	expect(await verifyPlazaGrant(token + "bad", secret)).toBeNull();
	expect(
		await verifyPlazaGrant(
			await signPlazaGrant({ ...grant, expires: 1 }, secret),
			secret,
		),
	).toBeNull();
	expect(
		(
			await proxy.fetch(
				new Request("https://cool.example/", {
					headers: { cookie: `agentero_plaza=${token}` },
				}),
				{ ...env, SITE: "modelscope" },
			)
		).status,
	).toBe(401);
});
it("bootstraps an HttpOnly scoped session without forwarding the grant or accepting an external redirect", async () => {
	const token = await signPlazaGrant(grant, secret);
	const request = `https://cool.example/_agentero/auth?grant=${token}`;
	const result = await proxy.fetch(
		new Request(request + "&path=%2Farxiv%2Fcs.AI"),
		env,
	);
	expect(result.status).toBe(303);
	expect(result.headers.get("location")).toBe(
		"https://cool.example/arxiv/cs.AI",
	);
	expect(result.headers.get("set-cookie")).toContain("HttpOnly");
	expect(result.headers.get("set-cookie")).toContain("Partitioned");
	expect(
		(
			await proxy.fetch(
				new Request(request + "&path=https%3A%2F%2Fevil.example"),
				env,
			)
		).status,
	).toBe(400);
});
it("keeps fixed upstream requests, isolates headers, and preserves actual website scripts", async () => {
	const token = await signPlazaGrant(grant, secret);
	const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
		expect(url.origin).toBe("https://papers.cool");
		expect(new Headers(init.headers).get("cookie")).toBe("site_pref=1");
		expect(new Headers(init.headers).has("authorization")).toBe(false);
		return new Response(
			'<html><head><script src="/static/cool.js"></script></head><body><a href="https://papers.cool/arxiv/1">Paper</a></body></html>',
			{
				headers: {
					"content-type": "text/html",
					"x-frame-options": "SAMEORIGIN",
					"content-security-policy": "frame-ancestors 'none'",
				},
			},
		);
	});
	vi.stubGlobal("fetch", fetcher);
	const result = await proxy.fetch(
		new Request("https://cool.example//evil.example/path", {
			headers: {
				cookie: `agentero_plaza=${token}; site_pref=1`,
				authorization: "must-not-forward",
			},
		}),
		env,
	);
	expect(result.status).toBe(200);
	expect(result.headers.has("x-frame-options")).toBe(false);
	expect(result.headers.get("content-security-policy")).toContain(
		"frame-ancestors https://app.example",
	);
	const html = await result.text();
	expect(html).toContain("/static/cool.js");
	expect(html).toContain("https://cool.example/arxiv/1");
	expect(html).toContain("agentero-plaza");
});
it("does not follow server redirects, permits no arbitrary methods or cross-origin writes, and blocks upstream service workers", async () => {
	const token = await signPlazaGrant(grant, secret);
	const headers = { cookie: `agentero_plaza=${token}` };
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(null, {
					status: 302,
					headers: { location: "https://external.example/file" },
				}),
		),
	);
	const result = await proxy.fetch(
		new Request("https://cool.example/redirect", { headers }),
		env,
	);
	expect(result.status).toBe(302);
	expect(result.headers.get("location")).toBe("https://external.example/file");
	expect(fetch).toHaveBeenCalledOnce();
	expect(
		(
			await proxy.fetch(
				new Request("https://cool.example/config", { method: "POST", headers }),
				env,
			)
		).status,
	).toBe(403);
	expect(
		(
			await proxy.fetch(
				new Request("https://cool.example/sw.js", {
					headers: { ...headers, "service-worker": "script" },
				}),
				env,
			)
		).status,
	).toBe(403);
});
it("syntax-checks both original bridges and escapes app labels before injection", () => {
	for (const bridge of [COOLPAPERS_LIVE_BRIDGE, MODELSCOPE_LIVE_BRIDGE]) {
		for (const script of bridge.matchAll(/<script>([\s\S]*?)<\/script>/g))
			expect(() => new Function(script[1])).not.toThrow();
	}
	const html = rewritePlazaHtml(
		"<html><head></head></html>",
		grant.proxy,
		"https://papers.cool",
		{ ...grant, labels: { ...grant.labels, import: "</script><script>bad()" } },
	);
	expect(html).not.toContain("</script><script>bad()");
});
it("reports expired iframe authorization to the signed application origin", async () => {
	const response = await proxy.fetch(new Request("https://cool.example/"), env);
	expect(response.status).toBe(401);
	const html = await response.text();
	expect(html).toContain('"source":"agentero-plaza"');
	expect(html).toContain('"errorCode":"unauthorized"');
	expect(html).toContain('"https://app.example"');
});
it("allows same-origin ModelScope PUT queries without leaking the proxy cookie", async () => {
	const token = await signPlazaGrant({ ...grant, site: "modelscope" }, secret);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: URL, init: RequestInit) => {
			expect(init.method).toBe("PUT");
			expect(new Headers(init.headers).get("origin")).toBe(
				"https://modelscope.cn",
			);
			expect(new Headers(init.headers).has("cookie")).toBe(false);
			return new Response("{}", {
				headers: { "content-type": "application/json" },
			});
		}),
	);
	const response = await proxy.fetch(
		new Request("https://cool.example/api/v1/dolphin/models", {
			method: "PUT",
			headers: {
				origin: "https://cool.example",
				cookie: `agentero_plaza=${token}`,
			},
			body: "{}",
		}),
		{ ...env, SITE: "modelscope" },
	);
	expect(response.status).toBe(200);
});
