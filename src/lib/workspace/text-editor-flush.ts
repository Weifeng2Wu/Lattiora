/**
 * Debounced-autosave flush registry for the CodeMirror TextEditor.
 *
 * Lib-layer registry (no JSX, outside the lazy text-editor chunk) so workspace
 * actions can flush a mounted editor's pending autosave before reading the
 * file — e.g. the compile button must not hand latexmk the pre-autosave disk
 * snapshot now that saves no longer auto-compile. Unmounted editors have no
 * entry: their unmount flush already landed, so disk is current.
 */

import { normalizeTabPath } from "@/lib/workspace/tabs";

export type TextEditorFlusher = () => Promise<boolean>;

const flushers = new Map<string, TextEditorFlusher>();

/**
 * Register the flusher of the mounted editor for `path` (one per path; a
 * later mount replaces an earlier one). Returns its unregister fn — an
 * unregister only drops the entry when it still owns it, so split panes of
 * the same path unmount without clobbering each other.
 */
export function registerTextEditorFlusher(
	path: string,
	flusher: TextEditorFlusher,
): () => void {
	const key = normalizeTabPath(path);
	flushers.set(key, flusher);
	return () => {
		if (flushers.get(key) === flusher) flushers.delete(key);
	};
}

/**
 * Flush the pending autosave of the editor mounted at `path`. Resolves true
 * when there is nothing to flush or the flush landed (disk is current);
 * false when the save was refused (disk-conflict guard, write error).
 */
export async function flushTextEditorFor(path: string): Promise<boolean> {
	const flusher = flushers.get(normalizeTabPath(path));
	if (!flusher) return true;
	try {
		return await flusher();
	} catch {
		return false;
	}
}

/**
 * Flush every mounted editor's pending autosave — the saveAll equivalent
 * before a TeX build: a multi-file project's root compile must read the
 * latest bytes of all its sections, not just the triggered file. Best-effort:
 * a refused flush (disk-conflict guard / write error) counts as false but
 * never rejects; callers compile from whatever landed on disk.
 */
export async function flushAllTextEditors(): Promise<boolean> {
	const results = await Promise.all(
		[...flushers.values()].map((flush) => flush().catch(() => false)),
	);
	return results.every(Boolean);
}
