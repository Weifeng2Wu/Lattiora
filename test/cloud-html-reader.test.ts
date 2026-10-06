import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("dompurify", () => ({
	default: {
		sanitize: () => {
			throw new Error("Sanitization is exercised in real Chromium");
		},
	},
}));
beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubGlobal("navigator", {
		onLine: true,
		locks: { request: (_name: string, fn: () => unknown) => fn() },
	});
});
afterEach(() => vi.unstubAllGlobals());
it("keeps downloaded HTML available offline and retains it when a refresh fails", async () => {
	const { loadHtmlPage } = await import("../src/lib/cloud/html-reader");
	const url = "https://paper.example/article";
	const fetcher = vi.fn(async () =>
		Response.json({
			url,
			body: "<html><p>Cached article</p></html>",
			contentType: "text/html",
		}),
	);
	vi.stubGlobal("fetch", fetcher);
	const original = await loadHtmlPage(url);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({ error: "feeds.http" }, { status: 502 })),
	);
	await expect(loadHtmlPage(url)).rejects.toThrow("feeds.http");
	Object.defineProperty(navigator, "onLine", {
		value: false,
		configurable: true,
	});
	expect(await loadHtmlPage(url)).toEqual(original);
	await expect(
		loadHtmlPage("https://paper.example/not-cached"),
	).rejects.toThrow();
});
it("rejects credential URLs, non-web schemes and responses that are not HTML", async () => {
	const { publicHtmlUrl, loadHtmlPage } = await import(
		"../src/lib/cloud/html-reader"
	);
	expect(() => publicHtmlUrl("https://user:secret@paper.example/a")).toThrow(
		"invalidEndpoint",
	);
	expect(() => publicHtmlUrl("javascript:alert(1)")).toThrow("invalidEndpoint");
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			Response.json({
				url: "https://paper.example/a",
				body: "%PDF",
				contentType: "application/pdf",
			}),
		),
	);
	await expect(loadHtmlPage("https://paper.example/a")).rejects.toThrow(
		"invalidProviderResponse",
	);
});
