import { createStore } from "zustand/vanilla";
import { cloudLock, type Flight, type LocalFile, localTransaction } from "./db";
import { editedFile, filesChanged, subscribeCloudFiles } from "./files";
import { type FileMeta, MAX_TEXT_BYTES } from "./protocol";

export const syncStore = createStore<{
	phase: "idle" | "syncing" | "offline" | "error";
	error: string;
	pending: number;
	lastSync: number;
}>(() => ({ phase: "idle", error: "", pending: 0, lastSync: 0 }));

export class CloudHttpError extends Error {
	constructor(
		public status: number,
		message: string,
		public current?: FileMeta,
	) {
		super(message);
	}
}
export async function cloudFetch(
	path: string,
	init?: RequestInit,
): Promise<Response> {
	const response = await fetch(path, {
		...init,
		signal: init?.signal ?? AbortSignal.timeout(60_000),
	});
	if (!response.ok) {
		const value = (await response.json().catch(() => ({}))) as {
			error?: string;
			current?: FileMeta;
		};
		throw new CloudHttpError(
			response.status,
			value.error ?? "requestFailed",
			value.current,
		);
	}
	return response;
}
export async function verifyWorkspace(): Promise<string> {
	const { workspaceId } = (await (await cloudFetch("/api/session")).json()) as {
		workspaceId: string;
	};
	if (!workspaceId) throw new Error("invalidWorkspace");
	const previous = localStorage.getItem("agentero-cloud-workspace");
	if (previous && previous !== workspaceId) throw new Error("workspaceChanged");
	localStorage.setItem("agentero-cloud-workspace", workspaceId);
	return workspaceId;
}

async function stage(path: string): Promise<Flight | null> {
	return cloudLock("files", async () => {
		const { file, flight } = await localTransaction(
			(files, state) => ({
				file: files.get(path),
				flight: state.flights[path],
			}),
			false,
		);
		if (flight) return flight;
		if (!file?.dirty) return null;
		const text =
			file.data &&
			file.size <= MAX_TEXT_BYTES &&
			/^(text\/|application\/json|inode\/directory)/.test(file.mime);
		const next: Flight = {
			write: {
				path,
				version: file.version,
				mutation_id: file.localId,
				deleted: Boolean(file.deleted),
				content: text ? await file.data!.text() : null,
				blob_key: !file.deleted && !text ? file.localId : null,
				mime: file.mime,
			},
			data: file.data,
			localId: file.localId,
		};
		await localTransaction((_files, state) => {
			state.flights[path] = next;
		});
		return next;
	});
}

function preserveConflict(
	files: Map<string, LocalFile>,
	local: LocalFile,
	remote: FileMeta,
): string {
	const root = `Conflicts/${crypto.randomUUID()}`;
	const path = `${root}/${local.path}`;
	// A manifest also records conflicting deletions and hidden metadata paths.
	const manifest = `${root}/conflict.json`;
	files.set(
		manifest,
		editedFile(
			manifest,
			new Blob(
				[
					JSON.stringify(
						{
							originalPath: local.path,
							localDeleted: Boolean(local.deleted),
							remoteDeleted: Boolean(remote.deleted),
							remoteVersion: remote.version,
							savedAt: new Date().toISOString(),
							recoveryPath: local.deleted ? null : path,
						},
						null,
						2,
					),
				],
				{ type: "application/json" },
			),
		),
	);
	if (!local.deleted && local.data)
		files.set(path, editedFile(path, local.data));
	return root;
}

async function applyRemote(
	meta: FileMeta,
	conflictFlight?: Flight,
): Promise<void> {
	const previous = await localTransaction(
		(files) => files.get(meta.path),
		false,
	);
	if (!conflictFlight && previous && previous.version >= meta.version) return;
	const data = meta.deleted
		? null
		: await (
				await cloudFetch(
					`/api/file?path=${encodeURIComponent(meta.path)}&version=${meta.version}`,
				)
			).blob();
	const changed = await cloudLock("files", () =>
		localTransaction((files, state) => {
			const local = files.get(meta.path);
			if (!conflictFlight && local && local.version >= meta.version) return [];
			if (
				conflictFlight &&
				state.flights[meta.path]?.localId !== conflictFlight.localId
			)
				throw new Error("localConflict");
			const paths = [meta.path];
			if (local?.dirty) paths.push(preserveConflict(files, local, meta));
			files.set(meta.path, {
				...meta,
				data,
				dirty: false,
				localId: meta.mutation_id,
			});
			if (conflictFlight) delete state.flights[meta.path];
			return paths;
		}),
	);
	if (changed.length) filesChanged(changed, true);
}

async function push(path: string): Promise<void> {
	const flight = await stage(path);
	if (!flight) return;
	if (flight.write.blob_key) {
		await cloudFetch(`/api/blobs/${flight.write.blob_key}`, {
			method: "PUT",
			body: flight.data,
		});
	}
	let meta: FileMeta;
	try {
		meta = await (
			await cloudFetch("/api/file", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(flight.write),
			})
		).json();
	} catch (error) {
		if (
			error instanceof CloudHttpError &&
			error.status === 409 &&
			error.message === "conflict" &&
			error.current
		) {
			await applyRemote(error.current, flight);
			return;
		}
		throw error;
	}
	await cloudLock("files", () =>
		localTransaction((files, state) => {
			const local = files.get(path);
			if (!local || state.flights[path]?.localId !== flight.localId)
				throw new Error("localConflict");
			// Only acknowledge the sent snapshot. An edit made during upload stays dirty.
			files.set(path, {
				...local,
				version: meta.version,
				seq: meta.seq,
				dirty: local.localId !== flight.localId,
			});
			delete state.flights[path];
		}),
	);
}

/** Persisted outbox + server CAS: safe across lost responses, reloads and tabs. */
export async function syncOnce(): Promise<void> {
	return cloudLock("sync", async () => {
		if (!navigator.onLine) {
			syncStore.setState({ phase: "offline" });
			return;
		}
		if (localStorage.getItem("agentero-cloud-locked")) return;
		syncStore.setState({ phase: "syncing", error: "" });
		try {
			await verifyWorkspace(); // Check account/workspace identity before sending local data.
			const paths = await localTransaction(
				(files, state) => [
					...new Set([
						...Object.keys(state.flights),
						...[...files.values()].filter((f) => f.dirty).map((f) => f.path),
					]),
				],
				false,
			);
			for (const path of paths) await push(path);
			let more = true;
			while (more) {
				const after = await localTransaction(
					(_files, state) => state.cursor,
					false,
				);
				const batch = (await (
					await cloudFetch(`/api/changes?after=${after}`)
				).json()) as { files: FileMeta[]; cursor: number; more: boolean };
				for (const meta of batch.files) await applyRemote(meta);
				await localTransaction((_files, state) => {
					state.cursor = batch.cursor;
				});
				more = batch.more;
			}
			syncStore.setState({ phase: "idle", lastSync: Date.now() });
		} catch (error) {
			syncStore.setState({
				phase: navigator.onLine ? "error" : "offline",
				error: error instanceof Error ? error.message : "requestFailed",
			});
			throw error;
		} finally {
			const pending = await localTransaction(
				(files) => [...files.values()].filter((f) => f.dirty).length,
				false,
			);
			syncStore.setState({ pending });
		}
	});
}

export function startSync(): () => void {
	let timer: ReturnType<typeof setTimeout>;
	let failures = 0;
	let running = false;
	let rerun = false;
	let stopped = false;
	const schedule = (delay = 1500) => {
		clearTimeout(timer);
		if (stopped) return;
		// A change arriving during a short run must not be replaced by its idle timer.
		if (running) rerun = true;
		else timer = setTimeout(run, delay);
	};
	const run = async () => {
		if (running) {
			rerun = true;
			return;
		}
		running = true;
		try {
			await syncOnce();
			failures = 0;
		} catch {
			failures++;
		} finally {
			running = false;
			schedule(
				failures
					? Math.min(300_000, 2000 * 2 ** Math.min(failures, 7)) +
							Math.random() * 1000
					: navigator.onLine && (rerun || syncStore.getState().pending > 0)
						? 1500
						: 60_000,
			);
			rerun = false;
		}
	};
	const online = () => schedule(0);
	const offline = () => syncStore.setState({ phase: "offline" });
	const focus = () => {
		if (document.visibilityState === "visible") schedule(0);
	};
	const unsubscribe = subscribeCloudFiles((_paths, remote) => {
		if (!remote) schedule();
	});
	window.addEventListener("online", online);
	window.addEventListener("offline", offline);
	document.addEventListener("visibilitychange", focus);
	schedule(0);
	return () => {
		stopped = true;
		clearTimeout(timer);
		unsubscribe();
		window.removeEventListener("online", online);
		window.removeEventListener("offline", offline);
		document.removeEventListener("visibilitychange", focus);
	};
}
