import type { FileMeta, FileWrite } from "./protocol";

export type LocalFile = FileMeta & {
	data: Blob | null;
	dirty: boolean;
	localId: string;
};
export type Flight = { write: FileWrite; data: Blob | null; localId: string };
export type LocalState = { cursor: number; flights: Record<string, Flight> };
let database: Promise<IDBDatabase> | undefined;

export function openCloudDb(): Promise<IDBDatabase> {
	database ??= new Promise((resolve, reject) => {
		const request = indexedDB.open("agentero-cloud-v1", 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore("files", { keyPath: "path" });
			request.result.createObjectStore("state");
		};
		request.onsuccess = () => {
			request.result.onversionchange = () => request.result.close();
			resolve(request.result);
		};
		request.onerror = () => {
			database = undefined;
			reject(request.error);
		};
		request.onblocked = () => {
			database = undefined;
			reject(new Error("databaseBlocked"));
		};
	});
	return database;
}

/** A single IDB transaction commits the file changes and outbox/cursor together.
 * Reducers are synchronous: no network or Blob reads can close the transaction. */
export async function localTransaction<T>(
	reduce: (files: Map<string, LocalFile>, state: LocalState) => T,
	write = true,
): Promise<T> {
	const db = await openCloudDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(
			["files", "state"],
			write ? "readwrite" : "readonly",
		);
		const store = tx.objectStore("files");
		const filesRequest = store.getAll();
		const stateRequest = tx.objectStore("state").get("sync");
		let result: T;
		let error: unknown;
		let ready = 0;
		const apply = () => {
			if (++ready !== 2) return;
			try {
				const previous = new Map(
					(filesRequest.result as LocalFile[]).map((file) => [file.path, file]),
				);
				const files = new Map(previous);
				const state: LocalState = stateRequest.result ?? {
					cursor: 0,
					flights: {},
				};
				result = reduce(files, state);
				if (write) {
					for (const [path, file] of files)
						if (previous.get(path) !== file) store.put(file);
					for (const path of previous.keys())
						if (!files.has(path)) store.delete(path);
					tx.objectStore("state").put(state, "sync");
				}
			} catch (cause) {
				error = cause;
				tx.abort();
			}
		};
		filesRequest.onsuccess = apply;
		stateRequest.onsuccess = apply;
		tx.oncomplete = () => resolve(result);
		tx.onabort = tx.onerror = () =>
			reject(error ?? tx.error ?? new Error("localSaveFailed"));
	});
}

export function cloudLock<T>(
	name: string,
	operation: () => Promise<T>,
): Promise<T> {
	// Web Locks are supported by current Firefox, Chromium and Safari on HTTPS.
	// Refuse an unsafe multi-tab fallback instead of risking silent data loss.
	if (!navigator.locks) throw new Error("browserUnsupported");
	return navigator.locks.request(`agentero-cloud-${name}`, operation);
}
