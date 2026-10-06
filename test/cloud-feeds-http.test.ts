import { afterEach, expect, it, vi } from "vitest";
import { feedRoutes, feedUrl } from "../cloudflare/feeds";

const request = (data: unknown) =>
	new Request("https://workspace.test/api/feeds/fetch", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(data),
	});
afterEach(() => vi.unstubAllGlobals());
it("fetches bounded feed text with conditional headers and never forwards credentials", async () => {
	const fetcher = vi.fn(
		async () =>
			new Response("<rss/>", {
				headers: { etag: "updated", "content-type": "application/rss+xml" },
			}),
	);
	vi.stubGlobal("fetch", fetcher);
	const response = await feedRoutes(
		request({ url: "https://feeds.example/rss#fragment", etag: "previous" }),
	);
	expect(await response?.json()).toMatchObject({
		body: "<rss/>",
		etag: "updated",
		url: "https://feeds.example/rss",
		status: 200,
	});
	const init = (fetcher.mock.calls as unknown as [URL, RequestInit][])[0][1];
	expect(new Headers(init.headers).get("if-none-match")).toBe("previous");
	expect(new Headers(init.headers).has("cookie")).toBe(false);
	expect(new Headers(init.headers).has("authorization")).toBe(false);
	expect(init.redirect).toBe("manual");
});
it("keeps 304 responses and rejects private redirects, credentials and oversized bodies", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(null, { status: 304 })),
	);
	expect(
		await (
			await feedRoutes(request({ url: "https://feeds.example/rss" }))
		)?.json(),
	).toMatchObject({ status: 304, body: "" });
	for (const url of [
		"http://127.0.0.1/rss",
		"https://a.local/rss",
		"https://[::1]/rss",
		"https://user:secret@example.org/rss",
		"file:///feed",
	])
		expect(() => feedUrl(url)).toThrow("feeds.invalid_url");
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(null, {
					status: 302,
					headers: { location: "http://localhost/private" },
				}),
		),
	);
	await expect(
		feedRoutes(request({ url: "https://feeds.example/rss" })),
	).rejects.toThrow("feeds.invalid_url");
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("x".repeat(2 * 1024 * 1024 + 1))),
	);
	await expect(
		feedRoutes(request({ url: "https://feeds.example/rss" })),
	).rejects.toThrow("feeds.too_large");
});
it("drops conditional values across origins and reports upstream failures", async () => {
	const fetcher = vi
		.fn()
		.mockResolvedValueOnce(
			new Response(null, {
				status: 302,
				headers: { location: "https://other.example/feed" },
			}),
		)
		.mockResolvedValueOnce(new Response("{}"));
	vi.stubGlobal("fetch", fetcher);
	await feedRoutes(
		request({ url: "https://feeds.example/rss", etag: "private-etag" }),
	);
	expect(
		new Headers(fetcher.mock.calls[1][1].headers).has("if-none-match"),
	).toBe(false);
	fetcher.mockResolvedValueOnce(
		new Response("secret upstream detail", { status: 403 }),
	);
	await expect(
		feedRoutes(request({ url: "https://feeds.example/rss" })),
	).rejects.toThrow("feeds.http");
});

it("allows bounded larger arXiv recommendation feeds only through the fixed category route", async () => {
	const fetcher = vi.fn(
		async () =>
			new Response("x".repeat(3 * 1024 * 1024), {
				headers: { "content-type": "application/rss+xml" },
			}),
	);
	vi.stubGlobal("fetch", fetcher);
	const rec = (body: unknown) =>
		new Request("https://workspace.test/api/recommend/feed", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	const result = await feedRoutes(rec({ category: "cs.AI" }));
	expect(((await result?.json()) as { body: string }).body.length).toBe(
		3 * 1024 * 1024,
	);
	expect(String((fetcher.mock.calls as unknown as [URL][])[0][0])).toBe(
		"https://rss.arxiv.org/rss/cs.AI",
	);
	await expect(
		feedRoutes(request({ url: "https://feeds.example/rss" })),
	).rejects.toMatchObject({ status: 413 });
	await expect(
		feedRoutes(rec({ category: "../private" })),
	).rejects.toMatchObject({ status: 400 });
	await expect(
		feedRoutes(rec({ url: "http://localhost" })),
	).rejects.toMatchObject({ status: 400 });
});
