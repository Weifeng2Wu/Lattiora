/**
 * Module-level map from an Agent runtime session id to the writes its
 * finalizers still owe:
 * - remember on send (merging writes, re-touching the session's TTL clock)
 * - take on complete / fail / cancel
 * - prune orphans by age / max size so long-lived app sessions cannot leak
 * - optionally, after take, keep a short grace window so concurrent
 *   list+reconcile readers cannot race a just-finalizing session
 *
 * ask threads and visual traces share this exact lifecycle; only the write
 * payload and the grace window differ.
 */
export type PendingSessionRegistry<T> = {
	/** Append `writes` to the session's pending list and touch its TTL clock. */
	remember(sessionId: string, writes: T[]): void;
	/** Remove and return the session's pending writes. */
	take(sessionId: string): T[];
	/** True while the session owns pending writes (or just took them, inside the grace window). */
	isPending(sessionId: string): boolean;
	/** Test helper — clear maps between unit cases. */
	resetForTests(): void;
};

export function createPendingSessionRegistry<T>({
	ttlMs,
	maxSessions,
	graceMs,
}: {
	/** Drop pending sessions older than this (ms). Long runs re-touch via remember merge. */
	ttlMs: number;
	/** Soft cap on concurrent pending sessions (LRU by updatedAt). */
	maxSessions: number;
	/** After take(), treat the session as still "active" this long so reconcile races cannot fail a completing mark. Omit when there is no take/reconcile race to shield. */
	graceMs?: number;
}): PendingSessionRegistry<T> {
	type PendingEntry = {
		writes: T[];
		/** Wall time when the entry was first remembered (or last extended). */
		updatedAt: number;
	};

	const pendingBySession = new Map<string, PendingEntry>();
	/** sessionId → when take() ran (grace against list/reconcile races). */
	const recentlyTakenAt = new Map<string, number>();

	function nowMs(): number {
		return Date.now();
	}

	function pruneStale(now = nowMs()): void {
		for (const [id, entry] of pendingBySession) {
			if (now - entry.updatedAt > ttlMs) {
				pendingBySession.delete(id);
			}
		}
		if (graceMs != null) {
			for (const [id, at] of recentlyTakenAt) {
				if (now - at > graceMs) {
					recentlyTakenAt.delete(id);
				}
			}
		}
		// LRU-ish: drop oldest pending sessions when over the soft cap.
		if (pendingBySession.size <= maxSessions) return;
		const ordered = [...pendingBySession.entries()].sort(
			(a, b) => a[1].updatedAt - b[1].updatedAt,
		);
		const drop = ordered.length - maxSessions;
		for (let i = 0; i < drop; i++) {
			const id = ordered[i]?.[0];
			if (id) pendingBySession.delete(id);
		}
	}

	return {
		remember(sessionId, writes) {
			if (!sessionId || !writes.length) return;
			pruneStale();
			const existing = pendingBySession.get(sessionId);
			pendingBySession.set(sessionId, {
				writes: [...(existing?.writes ?? []), ...writes],
				updatedAt: nowMs(),
			});
		},
		take(sessionId) {
			const entry = pendingBySession.get(sessionId);
			pendingBySession.delete(sessionId);
			const writes = entry?.writes ?? [];
			if (graceMs != null && writes.length) {
				recentlyTakenAt.set(sessionId, nowMs());
			}
			pruneStale();
			return writes;
		},
		isPending(sessionId) {
			if (!sessionId) return false;
			pruneStale();
			if (pendingBySession.has(sessionId)) return true;
			if (graceMs == null) return false;
			const takenAt = recentlyTakenAt.get(sessionId);
			return takenAt != null && nowMs() - takenAt < graceMs;
		},
		resetForTests() {
			pendingBySession.clear();
			recentlyTakenAt.clear();
		},
	};
}
