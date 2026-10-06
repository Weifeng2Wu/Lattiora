import { type Conference, parseConferences } from "./conference-deadlines";
import { openCloudDb } from "./db";
import type { FetchedFeed } from "./feed-parser";
import { cloudFetch } from "./sync";

export const CONFERENCE_SOURCE = "https://ccfddl.com/conference/allconf.json";
export const CONFERENCE_CACHE_TTL = 24 * 60 * 60 * 1000;
const cacheKey = "home-conference-catalog-v1";
export const conferenceSelectionKey = "agentero-home-conferences-v1";
export type ConferenceCatalog = {
	updatedAt: number;
	conferences: Conference[];
};
type CachedSource = { updatedAt: number; source: unknown };

export async function readConferenceCatalog(): Promise<ConferenceCatalog | null> {
	const db = await openCloudDb();
	const cached = await new Promise<CachedSource | undefined>(
		(resolve, reject) => {
			const tx = db.transaction("state", "readonly");
			const request = tx.objectStore("state").get(cacheKey);
			tx.oncomplete = () => resolve(request.result);
			tx.onabort = tx.onerror = () => reject(tx.error);
		},
	);
	if (!cached) return null;
	try {
		if (!Number.isFinite(cached.updatedAt)) return null;
		return {
			updatedAt: cached.updatedAt,
			conferences: parseConferences(cached.source),
		};
	} catch {
		return null;
	}
}

let pending: Promise<ConferenceCatalog> | undefined;
export function refreshConferenceCatalog(): Promise<ConferenceCatalog> {
	pending ??= (async () => {
		const response: FetchedFeed = await (
			await cloudFetch("/api/feeds/fetch", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ url: CONFERENCE_SOURCE }),
				signal: AbortSignal.timeout(25000),
			})
		).json();
		if (response.status !== 200) throw new Error("invalidConferences");
		const source: unknown = JSON.parse(response.body);
		const conferences = parseConferences(source);
		const updatedAt = Date.now();
		const db = await openCloudDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("state", "readwrite");
			tx.objectStore("state").put({ updatedAt, source }, cacheKey);
			tx.oncomplete = () => resolve();
			tx.onabort = tx.onerror = () => reject(tx.error);
		});
		return { updatedAt, conferences };
	})().finally(() => {
		pending = undefined;
	});
	return pending;
}

export function readConferenceSelection(): string[] {
	try {
		const value: unknown = JSON.parse(
			localStorage.getItem(conferenceSelectionKey) ?? "[]",
		);
		return Array.isArray(value)
			? [...new Set(value.filter((id): id is string => typeof id === "string"))]
			: [];
	} catch {
		return [];
	}
}

export function saveConferenceSelection(ids: string[]) {
	localStorage.setItem(conferenceSelectionKey, JSON.stringify(ids));
}
