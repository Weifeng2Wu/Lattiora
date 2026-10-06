import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Real parsing is covered in Chromium with RSS, Atom and JSON Feed fixtures.
vi.mock("../src/lib/cloud/feed-parser", () => ({
	feedLink: (url: string) => url,
	parseFeed: (source: { body: string }) => JSON.parse(source.body),
	discoverFeed: () => null,
	feedMarkdown: (body: string) => body,
	feedArticle: () => {
		throw new Error("feeds.body");
	},
}));
const item = (guid: string) => ({
	guid,
	title: guid,
	url: "https://arxiv.org/abs/1706.03762",
	publishedAt: "2026-09-29T00:00:00.000Z",
	summaryText: "summary",
	contentHtml: "body",
	paperUrl: "https://arxiv.org/abs/1706.03762",
});
const response = (items = [item("one")]) =>
	new Response(
		JSON.stringify({
			url: "https://feeds.example/rss",
			status: 200,
			contentType: "application/rss+xml",
			etag: "etag",
			lastModified: null,
			body: JSON.stringify({ title: "Feed", items }),
		}),
	);
beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubGlobal("navigator", {
		onLine: true,
		locks: { request: (_name: string, fn: () => unknown) => fn() },
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => response()),
	);
});
afterEach(() => vi.unstubAllGlobals());
it("preserves pin, rename and import edits made during refresh, plus cached offline bodies", async () => {
	const f = await import("../src/lib/cloud/feeds");
	const sub = await f.addFeed("https://feeds.example/rss");
	await expect(f.addFeed(sub.url)).rejects.toThrow("feeds.duplicate");
	const first = (await f.feedItems({})).items[0];
	let release!: (value: Response) => void;
	vi.stubGlobal(
		"fetch",
		vi.fn(
			() =>
				new Promise<Response>((r) => {
					release = r;
				}),
		),
	);
	const refresh = f.refreshFeeds(sub.id);
	await vi.waitUntil(() => Boolean(release));
	await f.pinFeed(sub.id, true);
	await f.renameFeed(sub.id, "My feed");
	await f.markFeedImported(first.id);
	release(response([item("one"), item("two")]));
	expect(await refresh).toMatchObject({ fetched: 1, failed: 0 });
	expect((await f.listFeeds()).subscriptions[0]).toMatchObject({
		pinned: true,
		title: "My feed",
		itemCount: 2,
	});
	expect(
		(await f.feedItems({})).items.find((row) => row.id === first.id)
			?.importedAt,
	).toBeTruthy();
	vi.stubGlobal("navigator", { ...navigator, onLine: false });
	expect((await f.resolveFeedBody(first.id)).bodyMarkdown).toBe("body");
	expect((await f.resolveFeedBody(first.id)).bodyMarkdown).toBe("body");
	const files = await import("../src/lib/cloud/files");
	expect((await files.listLocalFiles()).every((file) => file.dirty)).toBe(true);
	await f.removeFeed(sub.id);
	expect((await f.listFeeds()).subscriptions).toEqual([]);
	expect((await files.listLocalFiles()).every((file) => file.deleted)).toBe(
		true,
	);
});
it("does not resurrect removed feeds from a late refresh and retains data on fetch failure", async () => {
	const f = await import("../src/lib/cloud/feeds");
	const sub = await f.addFeed("https://feeds.example/rss");
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(JSON.stringify({ error: "feeds.http" }), { status: 502 }),
		),
	);
	expect(await f.refreshFeeds()).toMatchObject({ failed: 1 });
	expect((await f.feedItems({})).items).toHaveLength(1);
	expect((await f.listFeeds()).subscriptions[0].lastError).toBe("feeds.http");
	let release!: (value: Response) => void;
	vi.stubGlobal(
		"fetch",
		vi.fn(
			() =>
				new Promise<Response>((r) => {
					release = r;
				}),
		),
	);
	const refresh = f.refreshFeeds(sub.id);
	await vi.waitUntil(() => Boolean(release));
	await f.removeFeed(sub.id);
	release(response());
	await refresh;
	expect((await f.listFeeds()).subscriptions).toEqual([]);
});
