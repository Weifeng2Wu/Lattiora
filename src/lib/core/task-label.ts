/**
 * Background-task subject / detail helpers.
 *
 * Catalog title lookup is injected from the paper layer so `lib/core` stays a
 * leaf (see dependency-cruiser `core-stays-leaf`). Without a lookup, labels
 * fall back to the paper folder basename.
 */

function normalizePaperRel(path: string): string {
	return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/** Optional catalog title for a normalized `papers/…/<id>` relative path. */
export type PaperTitleLookup = (
	normalizedPaperRel: string,
) => string | undefined;

let paperTitleLookup: PaperTitleLookup | null = null;

/** Wire catalog titles from the paper layer (idempotent; last writer wins). */
export function registerPaperTitleLookup(lookup: PaperTitleLookup): void {
	paperTitleLookup = lookup;
}

/** Test / teardown helper — clears the injected lookup. */
export function clearPaperTitleLookup(): void {
	paperTitleLookup = null;
}

/**
 * Display label for a paper-scoped background task.
 * Returns `undefined` when there is no paper target (vault-scope jobs).
 */
export function paperTaskLabel(
	paperPath: string | null | undefined,
): string | undefined {
	const norm = normalizePaperRel(paperPath ?? "");
	if (!norm) return undefined;

	const parts = norm.split("/").filter(Boolean);
	// Paper units live under `papers/…/<id>`; bare `papers` / empty are not.
	if (parts[0] !== "papers" || parts.length < 2) return undefined;

	const folder = parts[parts.length - 1] ?? "";
	if (!folder) return undefined;

	const title = paperTitleLookup?.(norm)?.trim();
	if (title) return title.slice(0, 80);
	return folder.slice(0, 80);
}

/** Join a stable paper subject with a transient status / progress line. */
export function joinTaskDetail(
	subject: string | undefined,
	status: string | undefined,
): string | undefined {
	const s = subject?.trim();
	const st = status?.trim();
	if (s && st && s !== st) {
		if (st.startsWith(s)) return st.slice(0, 120);
		return `${s} · ${st}`.slice(0, 120);
	}
	const out = s || st;
	return out ? out.slice(0, 120) : undefined;
}
