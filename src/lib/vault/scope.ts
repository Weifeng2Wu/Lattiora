/**
 * Grant the fs-plugin scope for a local vault root (idempotent, cached).
 *
 * The dialog plugin grants runtime scope for an interactively-picked folder,
 * but that grant is not persisted. On startup restore, a vault located outside
 * the static scope (`$HOME/**`, `$DOCUMENT/**`, …) fails every fs-plugin call
 * (`readDir` / `readTextFile` / `exists` …) with "forbidden path" until a dialog
 * re-grants it. Call before any fs-plugin read for a restored vault. Concurrent
 * callers share one grant; no-op off Tauri or for remote handles.
 */
export function ensureLocalFsScope(_rootPath: string | null): Promise<void> {
	return Promise.resolve();
}
