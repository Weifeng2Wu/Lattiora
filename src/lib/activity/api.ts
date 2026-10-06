import type {
	UsageEvent_Serialize,
	UsageKindCount,
	UsageRecord,
} from "@/lib/core/bindings";
export type ActivityRecord = UsageRecord;
export type UsageEvent = UsageEvent_Serialize;
export type { UsageKindCount };

let database: Promise<IDBDatabase> | undefined;
function openActivityDb(): Promise<IDBDatabase> {
	database ??= new Promise((resolve, reject) => {
		const request = indexedDB.open("agentero-activity-v1", 1);
		request.onupgradeneeded = () =>
			request.result.createObjectStore("events", {
				keyPath: "id",
				autoIncrement: true,
			});
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => {
			database = undefined;
			reject(request.error);
		};
	});
	return database;
}
async function transaction<T>(
	mode: IDBTransactionMode,
	run: (store: IDBObjectStore, result: (value: T) => void) => void,
): Promise<T> {
	const db = await openActivityDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction("events", mode);
		let result: T;
		tx.oncomplete = () => resolve(result);
		tx.onerror = tx.onabort = () => reject(tx.error);
		try {
			run(tx.objectStore("events"), (value) => {
				result = value;
			});
		} catch (error) {
			tx.abort();
			reject(error);
		}
	});
}
export async function recordActivityEvents(
	events: ActivityRecord[],
): Promise<number> {
	return transaction("readwrite", (store, done) => {
		for (const event of events)
			store.add({
				ts: event.ts ?? new Date().toISOString(),
				vault: event.vault ?? null,
				kind: event.kind,
				path: event.path ?? null,
				mode: event.mode ?? null,
				durMs: event.durMs ?? null,
				extra: event.extra ?? null,
			});
		done(events.length);
	});
}
async function allEvents(): Promise<UsageEvent[]> {
	return transaction("readonly", (store, done) => {
		const req = store.getAll();
		req.onsuccess = () => done(req.result);
	});
}
export async function listUsageEvents(
	opts: {
		vault?: string;
		kind?: string;
		path?: string;
		since?: string;
		limit?: number;
	} = {},
): Promise<UsageEvent[]> {
	return (await allEvents())
		.filter(
			(e) =>
				(!opts.vault || e.vault === opts.vault) &&
				(!opts.kind || e.kind === opts.kind) &&
				(!opts.path || e.path === opts.path) &&
				(!opts.since || e.ts >= opts.since),
		)
		.sort((a, b) => b.ts.localeCompare(a.ts) || b.id - a.id)
		.slice(0, opts.limit ?? 500);
}
export async function summarizeUsage(
	opts: { vault?: string; since?: string } = {},
): Promise<UsageKindCount[]> {
	const groups = new Map<string, UsageKindCount>();
	for (const e of await listUsageEvents({
		...opts,
		limit: Number.MAX_SAFE_INTEGER,
	})) {
		const row = groups.get(e.kind) ?? { kind: e.kind, count: 0, durMs: 0 };
		row.count++;
		row.durMs += e.durMs ?? 0;
		groups.set(e.kind, row);
	}
	return [...groups.values()];
}
export async function clearUsage(vault?: string): Promise<number> {
	return transaction("readwrite", (store, done) => {
		const request = store.openCursor();
		let count = 0;
		request.onsuccess = () => {
			const cursor = request.result;
			if (!cursor) return done(count);
			if (!vault || cursor.value.vault === vault) {
				cursor.delete();
				count++;
			}
			cursor.continue();
		};
	});
}
