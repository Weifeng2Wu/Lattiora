/**
 * Buffered activity tracker. Call `track()` from action funnels; events flush
 * to this browser’s IndexedDB activity database.
 */

import { type ActivityRecord, recordActivityEvents } from "@/lib/activity/api";
import { type ActivityKind, isActivityKind } from "@/lib/activity/kinds";
import type { Json } from "@/lib/core/bindings";
import { errorText } from "@/lib/core/error";
import { logger } from "@/lib/core/logger";
import { toVaultRelative } from "@/lib/core/path";
import { getVaultPath } from "@/lib/vault/store";

const FLUSH_MS = 5000;
const FLUSH_SIZE = 50;
const DEDUPE_MS = 1000;
const MAX_FOCUS_MS = 30 * 60 * 1000;
const SESSION_MIN_MS = 10_000;

type TrackPayload = {
	path?: string;
	mode?: string;
	durMs?: number;
	extra?: Json;
};

type Buffered = ActivityRecord & { _key: string; _at: number };

const buffer: Buffered[] = [];
const recent = new Map<string, number>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let focused: { path: string; startedAt: number } | null = null;
let flushing = false;

export function track(
	kind: ActivityKind | string,
	payload: TrackPayload = {},
): void {
	if (!isActivityKind(kind)) {
		logger.warn("activity: unknown kind", { kind });
		return;
	}

	const vault = getVaultPath() ?? undefined;
	const path = normalizePath(vault, payload.path);
	const key = `${kind}|${path ?? ""}|${payload.mode ?? ""}`;
	const now = Date.now();
	const last = recent.get(key);
	if (last != null && now - last < DEDUPE_MS) return;
	recent.set(key, now);

	buffer.push({
		ts: new Date(now).toISOString(),
		vault,
		kind,
		path,
		mode: payload.mode,
		durMs: payload.durMs,
		extra: payload.extra,
		_key: key,
		_at: now,
	});
	if (buffer.length >= FLUSH_SIZE) {
		void flushActivity();
		return;
	}
	scheduleFlush();
}

/** Pair focus/blur so only the active Dockview panel accumulates reading time. */
export function notePaperFocus(absOrRelPath: string | null): void {
	const vault = getVaultPath();
	const path = absOrRelPath ? normalizePath(vault, absOrRelPath) : null;
	const now = Date.now();
	if (focused) {
		const dur = Math.min(now - focused.startedAt, MAX_FOCUS_MS);
		if (dur >= 1000) {
			track("paper.blur", { path: focused.path, durMs: dur });
			if (dur >= SESSION_MIN_MS) {
				track("paper.session", { path: focused.path, durMs: dur });
			}
		}
	}
	focused = path ? { path, startedAt: now } : null;
	if (path) track("paper.focus", { path });
}

export function startActivityTracking(): () => void {
	if (started || typeof window === "undefined") return () => undefined;
	started = true;
	const onHide = () => {
		notePaperFocus(null);
		void flushActivity();
	};
	window.addEventListener("blur", onHide);
	window.addEventListener("pagehide", onHide);
	window.addEventListener("beforeunload", onHide);
	return () => {
		window.removeEventListener("blur", onHide);
		window.removeEventListener("pagehide", onHide);
		window.removeEventListener("beforeunload", onHide);
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushTimer = null;
		}
		started = false;
	};
}

export async function flushActivity(): Promise<void> {
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
	if (flushing || buffer.length === 0) return;
	flushing = true;
	const batch = buffer.splice(0, buffer.length);
	try {
		await recordActivityEvents(
			batch.map(({ _key, _at, ...event }) => {
				void _key;
				void _at;
				return event;
			}),
		);
	} catch (error) {
		buffer.unshift(...batch);
		scheduleFlush();
		logger.warn("activity flush failed", {
			error: errorText(error),
		});
	} finally {
		flushing = false;
	}
}

function scheduleFlush(): void {
	if (flushTimer) return;
	flushTimer = setTimeout(() => {
		flushTimer = null;
		void flushActivity();
	}, FLUSH_MS);
}

function normalizePath(
	vault: string | null | undefined,
	path: string | undefined,
): string | undefined {
	if (!path) return undefined;
	const rel = toVaultRelative(vault ?? null, path)
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "");
	return rel || undefined;
}

/** Test helper: reset in-memory buffer. */
export function resetActivityBufferForTests(): void {
	buffer.length = 0;
	recent.clear();
	focused = null;
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
	flushing = false;
	started = false;
}

export function pendingActivityCountForTests(): number {
	return buffer.length;
}
