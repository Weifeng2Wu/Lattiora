import { readJsonStorage, writeJsonStorage } from "@/lib/core/storage";

/**
 * Best-effort cache of hydrated ACP history titles.
 *
 * `session/list` does not include user prompts, so titles for agents like Kimi
 * must be derived via `session/load`. Caching avoids re-loading every session
 * on each Agent panel mount / history open (#484).
 *
 * Non-authoritative: a missing/stale entry just triggers another load.
 */

const STORAGE_KEY = "agentero.agent-history-titles.v1";
const MAX_ENTRIES = 400;

type CacheMap = Record<string, string>;

function cacheKey(agentId: string, sessionId: string): string {
	return `${agentId}\0${sessionId}`;
}

function readAll(): CacheMap {
	const parsed = readJsonStorage<unknown>(STORAGE_KEY, null);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return {};
	}
	const out: CacheMap = {};
	for (const [k, v] of Object.entries(parsed as CacheMap)) {
		if (typeof k === "string" && typeof v === "string" && v.trim()) {
			out[k] = v.trim();
		}
	}
	return out;
}

function writeAll(map: CacheMap): void {
	const entries = Object.entries(map);
	const trimmed =
		entries.length > MAX_ENTRIES
			? Object.fromEntries(entries.slice(entries.length - MAX_ENTRIES))
			: map;
	writeJsonStorage(STORAGE_KEY, trimmed);
}

export function getCachedHistoryTitle(
	agentId: string,
	sessionId: string,
): string | null {
	const id = sessionId.trim();
	const agent = agentId.trim();
	if (!id || !agent) return null;
	const value = readAll()[cacheKey(agent, id)];
	return value?.trim() || null;
}

export function setCachedHistoryTitle(
	agentId: string,
	sessionId: string,
	title: string,
): void {
	const id = sessionId.trim();
	const agent = agentId.trim();
	const cleaned = title.trim();
	if (!id || !agent || !cleaned) return;
	const map = readAll();
	map[cacheKey(agent, id)] = cleaned;
	writeAll(map);
}

/** Apply cached titles onto sessions that still lack a human label. */
export function applyCachedHistoryTitles(
	agentId: string,
	sessions: Array<{
		id: string;
		title: string;
		providerSessionId?: string | null;
	}>,
): typeof sessions {
	if (sessions.length === 0) return sessions;
	const map = readAll();
	if (Object.keys(map).length === 0) return sessions;
	return sessions.map((session) => {
		if (session.title.trim()) return session;
		const providerId = session.providerSessionId?.trim() || session.id;
		const cached =
			map[cacheKey(agentId, providerId)] || map[cacheKey(agentId, session.id)];
		if (!cached?.trim()) return session;
		return { ...session, title: cached.trim() };
	});
}
