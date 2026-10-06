import { afterEach, expect, it, vi } from "vitest";
import { researchRoutes } from "../cloudflare/research";

afterEach(() => vi.unstubAllGlobals());
it("fetches only an arXiv source identifier and does not forward application credentials", async () => {
	const fetcher = vi.fn(async () => new Response("source archive"));
	vi.stubGlobal("fetch", fetcher);
	const response = await researchRoutes(
		new Request("https://app.test/api/arxiv-source?id=2501.00001v2", {
			headers: { cookie: "private" },
		}),
	);
	expect(await response?.text()).toBe("source archive");
	const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
	expect(url.href).toBe("https://arxiv.org/src/2501.00001v2");
	expect(new Headers(init.headers).has("cookie")).toBe(false);
	expect(init.redirect).toBe("manual");
	await expect(
		researchRoutes(
			new Request("https://app.test/api/arxiv-source?id=..%2Fsecret"),
		),
	).rejects.toThrow("invalidIdentifier");
	expect(fetcher).toHaveBeenCalledTimes(1);
});
it("bounds archive downloads and rejects redirects to private addresses", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response("", {
					headers: { "content-length": String(33 * 1024 * 1024) },
				}),
		),
	);
	await expect(
		researchRoutes(
			new Request("https://app.test/api/arxiv-source?id=2501.00001"),
		),
	).rejects.toThrow("tooLarge");
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(null, {
					status: 302,
					headers: { location: "http://127.0.0.1/private" },
				}),
		),
	);
	await expect(
		researchRoutes(
			new Request("https://app.test/api/arxiv-source?id=2501.00001"),
		),
	).rejects.toThrow("invalidEndpoint");
});
