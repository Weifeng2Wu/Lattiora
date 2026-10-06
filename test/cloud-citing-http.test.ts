import { afterEach, expect, it, vi } from "vitest";
import { citingRoutes } from "../cloudflare/citing";
import type { Env } from "../cloudflare/worker";

vi.mock("../cloudflare/settings", () => ({
	readSettingsSecret: async () => "saved-secret",
}));
afterEach(() => vi.unstubAllGlobals());
const request = (input: unknown) =>
	new Request("https://app.test/api/citing", {
		method: "POST",
		body: JSON.stringify(input),
		headers: { "content-type": "application/json", cookie: "private-cookie" },
	});
it("tests a real Graph query with encrypted credentials, bounded batches and no redirect following", async () => {
	const fetcher = vi.fn(async () =>
		Response.json([{ paperId: "a".repeat(40) }]),
	);
	vi.stubGlobal("fetch", fetcher);
	const response = await citingRoutes(
		request({
			baseUrl: "https://s2.example/graph/v1",
			apiKey: "********",
			operation: "probe",
		}),
		{} as Env,
	);
	expect(await response?.json()).toMatchObject({ ok: true });
	const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
	expect(url.pathname).toBe("/graph/v1/paper/batch");
	expect(init.redirect).toBe("manual");
	expect(init.headers).toEqual({
		"content-type": "application/json",
		"x-api-key": "saved-secret",
	});
	expect(JSON.parse(String(init.body)).ids).toEqual(["ARXIV:1706.03762"]);
});
it("rejects malformed pages and private endpoints without leaking upstream content", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({ wrong: [] })),
	);
	await expect(
		citingRoutes(
			request({
				baseUrl: "https://s2.example/graph/v1",
				operation: "citations",
				id: "a".repeat(40),
				offset: 0,
			}),
			{} as Env,
		),
	).rejects.toThrow("invalidProviderResponse");
	await expect(
		citingRoutes(
			request({ baseUrl: "http://127.0.0.1", operation: "probe" }),
			{} as Env,
		),
	).rejects.toThrow("invalidEndpoint");
});
