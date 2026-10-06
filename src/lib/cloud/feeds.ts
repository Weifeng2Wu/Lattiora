import type { FeedItem, FeedSub, FeedsItemsArgs } from "@/lib/core/bindings";
import { cloudLock } from "./db";
import {
	discoverFeed,
	type FetchedFeed,
	feedArticle,
	feedLink,
	feedMarkdown,
	type ParsedFeedItem,
	parseFeed,
} from "./feed-parser";
import {
	listLocalFiles,
	readLocalFile,
	removeLocal,
	writeLocalFile,
} from "./files";
import { cloudFetch } from "./sync";

export const FEEDS_ROOT = ".agentero/feeds/";
type StoredItem = Omit<FeedItem, "subscriptionTitle"> & {
	guid: string;
	firstSeenAt: string;
};
type FeedRecord = {
	version: 1;
	sub: FeedSub;
	items: StoredItem[];
	etag: string | null;
	lastModified: string | null;
};
const pathFor = (id: string) => {
	if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("feeds.not_found");
	return `${FEEDS_ROOT}${id}/subscription.json`;
};
const now = () => new Date().toISOString();
async function hash(text: string) {
	return [
		...new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
		),
	]
		.map((n) => n.toString(16).padStart(2, "0"))
		.join("");
}
const order = (a: StoredItem, b: StoredItem) =>
	(b.publishedAt ?? b.firstSeenAt).localeCompare(
		a.publishedAt ?? a.firstSeenAt,
	) || b.id.localeCompare(a.id);
const wireItem = (record: FeedRecord, item: StoredItem): FeedItem => ({
	...item,
	subscriptionTitle: record.sub.title,
});
async function read(id: string): Promise<{ record: FeedRecord; raw: string }> {
	const raw = await (await readLocalFile(pathFor(id))).text();
	const record = JSON.parse(raw) as FeedRecord;
	if (
		record.version !== 1 ||
		record.sub?.id !== id ||
		!Array.isArray(record.items)
	)
		throw new Error("feeds.parse");
	return { record, raw };
}
async function update(
	id: string,
	change: (record: FeedRecord) => void,
): Promise<FeedRecord> {
	return cloudLock(`feed-${id}`, async () => {
		const { record, raw } = await read(id);
		change(record);
		await writeLocalFile(
			pathFor(id),
			new Blob([JSON.stringify(record)], { type: "application/json" }),
			{ expectedText: raw },
		);
		return record;
	});
}
async function records() {
	return Promise.all(
		(await listLocalFiles())
			.filter(
				(f) =>
					!f.deleted &&
					f.path.startsWith(FEEDS_ROOT) &&
					f.path.endsWith("/subscription.json"),
			)
			.map(async (f) => {
				const id = f.path.slice(FEEDS_ROOT.length).split("/")[0];
				return (await read(id)).record;
			}),
	);
}
async function fetchSource(
	url: string,
	etag?: string | null,
	lastModified?: string | null,
): Promise<FetchedFeed> {
	return (
		await cloudFetch("/api/feeds/fetch", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ url, etag, lastModified }),
		})
	).json();
}
async function loadSource(
	url: string,
	etag?: string | null,
	lastModified?: string | null,
) {
	let response = await fetchSource(url, etag, lastModified);
	if (response.status === 304) return { response, parsed: null };
	if (
		/text\/html/i.test(response.contentType) ||
		/^\s*(?:<!doctype html|<html)/i.test(response.body)
	) {
		const alternate = discoverFeed(response.body, response.url);
		if (!alternate) throw new Error("feeds.no_feed");
		response = await fetchSource(alternate);
	}
	return { response, parsed: parseFeed(response) };
}
async function mergeItems(
	id: string,
	incoming: ParsedFeedItem[],
	previous: StoredItem[],
): Promise<StoredItem[]> {
	const merged = new Map(previous.map((item) => [item.guid, item]));
	for (const item of incoming) {
		const old = merged.get(item.guid);
		merged.set(item.guid, {
			...item,
			id: old?.id ?? `${id}:${await hash(item.guid)}`,
			subscriptionId: id,
			importedAt: old?.importedAt ?? null,
			bodyMarkdown: null,
			firstSeenAt: old?.firstSeenAt ?? now(),
		});
	}
	return [...merged.values()].sort(order).slice(0, 200);
}

export async function listFeeds() {
	return { subscriptions: (await records()).map((record) => record.sub) };
}
export async function addFeed(
	url: string,
	title?: string | null,
): Promise<FeedSub> {
	const input = feedLink(url);
	if (!input) throw new Error("feeds.invalid_url");
	const { response, parsed } = await loadSource(input);
	if (!parsed?.items.length) throw new Error("feeds.empty");
	const canonical = new URL(response.url);
	canonical.hash = "";
	const id = await hash(canonical.href);
	return cloudLock(`feed-${id}`, async () => {
		const file = (await listLocalFiles()).find(
			(f) => f.path === pathFor(id) && !f.deleted,
		);
		if (file) throw new Error("feeds.duplicate");
		const items = await mergeItems(id, parsed.items, []);
		const sub: FeedSub = {
			id,
			url: canonical.href,
			title: title?.trim() || parsed.title,
			addedAt: now(),
			lastFetchedAt: now(),
			lastError: null,
			itemCount: items.length,
			pinned: false,
			pinnedAt: null,
		};
		const record: FeedRecord = {
			version: 1,
			sub,
			items,
			etag: response.etag,
			lastModified: response.lastModified,
		};
		await writeLocalFile(
			pathFor(id),
			new Blob([JSON.stringify(record)], { type: "application/json" }),
			{ expectedText: null },
		);
		return sub;
	});
}
export async function renameFeed(id: string, title: string) {
	if (!title.trim()) throw new Error("feeds.empty_title");
	return (
		await update(id, (r) => {
			r.sub.title = title.trim();
		})
	).sub;
}
export async function pinFeed(id: string, pinned: boolean) {
	return (
		await update(id, (r) => {
			r.sub.pinned = pinned;
			r.sub.pinnedAt = pinned ? now() : null;
		})
	).sub;
}
export async function removeFeed(id: string) {
	await cloudLock(`feed-${id}`, () =>
		removeLocal(pathFor(id).slice(0, -"/subscription.json".length), true),
	);
	return null;
}
export async function refreshFeeds(id?: string | null, staleOnly = false) {
	let fetched = 0,
		failed = 0;
	const selected = (await records()).filter(
		(r) =>
			(!id || r.sub.id === id) &&
			(!staleOnly ||
				!r.sub.lastFetchedAt ||
				Date.now() - Date.parse(r.sub.lastFetchedAt) >= 15 * 60_000),
	);
	if (!navigator.onLine && staleOnly)
		return { ...(await listFeeds()), fetched, failed };
	for (let offset = 0; offset < selected.length; offset += 4) {
		await Promise.all(
			selected.slice(offset, offset + 4).map(async (old) => {
				try {
					const { response, parsed } = await loadSource(
						old.sub.url,
						old.etag,
						old.lastModified,
					);
					if (parsed && !parsed.items.length) throw new Error("feeds.empty");
					// Fetch outside the lock, then merge against the latest pin/import/rename state.
					await cloudLock(`feed-${old.sub.id}`, async () => {
						const { record, raw } = await read(old.sub.id);
						if (parsed)
							record.items = await mergeItems(
								record.sub.id,
								parsed.items,
								record.items,
							);
						record.sub.lastFetchedAt = now();
						record.sub.lastError = null;
						record.sub.itemCount = record.items.length;
						record.etag = response.etag ?? record.etag;
						record.lastModified = response.lastModified ?? record.lastModified;
						await writeLocalFile(
							pathFor(record.sub.id),
							new Blob([JSON.stringify(record)], { type: "application/json" }),
							{ expectedText: raw },
						);
					});
					fetched++;
				} catch (error) {
					failed++;
					const message =
						error instanceof Error && error.message.startsWith("feeds.")
							? error.message
							: "feeds.fetch";
					// A removed subscription stays removed; never recreate it on a late response.
					await update(old.sub.id, (r) => {
						r.sub.lastError = message;
					}).catch(() => {});
				}
			}),
		);
	}
	return { ...(await listFeeds()), fetched, failed };
}
export async function feedItems(args: FeedsItemsArgs) {
	const all = (await records()).filter(
		(r) => !args.subscriptionId || r.sub.id === args.subscriptionId,
	);
	const items = all
		.flatMap((r) => r.items.map((item) => ({ record: r, item })))
		.filter(
			({ item }) =>
				(args.filter !== "paper" || item.paperUrl) &&
				(args.filter !== "other" || !item.paperUrl) &&
				(!args.beforePublishedAt ||
					(item.publishedAt ?? item.firstSeenAt) < args.beforePublishedAt ||
					((item.publishedAt ?? item.firstSeenAt) === args.beforePublishedAt &&
						item.id < (args.beforeId ?? ""))),
		);
	items.sort((a, b) => order(a.item, b.item));
	return {
		items: items
			.slice(0, Math.max(1, Math.min(200, args.limit ?? 100)))
			.map(({ record, item }) => wireItem(record, item)),
	};
}
const itemParts = (id: string) => {
	const [sub, item] = id.split(":");
	pathFor(sub);
	if (!/^[a-f0-9]{64}$/.test(item ?? "")) throw new Error("feeds.not_found");
	return { sub, body: `${FEEDS_ROOT}${sub}/body-${item}.json` };
};
export async function markFeedImported(id: string) {
	const { sub } = itemParts(id);
	const record = await update(sub, (r) => {
		const item = r.items.find((item) => item.id === id);
		if (!item) throw new Error("feeds.not_found");
		item.importedAt = now();
	});
	return wireItem(record, record.items.find((item) => item.id === id)!);
}
export async function resolveFeedBody(id: string): Promise<FeedItem> {
	const { sub, body } = itemParts(id);
	const { record } = await read(sub);
	const item = record.items.find((item) => item.id === id);
	if (!item) throw new Error("feeds.not_found");
	const cached = (await listLocalFiles()).find(
		(file) => file.path === body && !file.deleted,
	);
	if (cached?.data)
		return {
			...wireItem(record, item),
			...JSON.parse(await cached.data.text()),
		};
	let bodyMarkdown = item.contentHtml
		? feedMarkdown(item.contentHtml, item.url ?? record.sub.url)
		: item.summaryText;
	let paperUrl = item.paperUrl;
	if (
		navigator.onLine &&
		item.url &&
		(!paperUrl || /(?:\[\.\.\.\]|…)\s*$/.test(item.summaryText))
	) {
		// Keep a readable RSS fallback on hosts that reject article extraction.
		try {
			const response = await fetchSource(item.url);
			const article = feedArticle(response.body, response.url);
			if (article.bodyMarkdown) bodyMarkdown = article.bodyMarkdown;
			paperUrl = article.paperUrl ?? paperUrl;
		} catch {
			/* The original RSS body remains visible; no full-text success is claimed. */
		}
	}
	if (!bodyMarkdown.trim()) throw new Error("feeds.body");
	const result = { bodyMarkdown, paperUrl };
	await cloudLock(`feed-${sub}`, async () => {
		await read(sub); // Refuse to resurrect data after subscription removal.
		await writeLocalFile(
			body,
			new Blob([JSON.stringify(result)], { type: "application/json" }),
			{ expectedText: null },
		);
	});
	if (paperUrl !== item.paperUrl)
		await update(sub, (r) => {
			const current = r.items.find((row) => row.id === id);
			if (current) current.paperUrl = paperUrl;
		});
	return { ...wireItem(record, item), ...result };
}
