/**
 * Normalize agent / editor citation hrefs so clicks open the paper PDF (with
 * optional #page= / #section= / #figure= fragments) instead of TeX source paths.
 */

const TEX_EXT = /\.(tex|ltx)$/i;
/** Trailing agent status tags still appear in older / permission-denied replies. */
const STATUS_TAG = /\s*\[(blocked|read|failed|denied)\]/gi;
const STATUS_LINK_LABELS = new Set(["blocked", "read", "failed", "denied"]);

/** Fragment keys understood by Host `resolve_citation`. */
export const CITATION_FRAGMENT_KEYS = new Set([
	"page",
	"section",
	"figure",
	"table",
	"algorithm",
	"formula",
	"region",
]);

/** Split `path#fragment` (fragment may be empty). */
export function splitCitationHref(href: string): {
	path: string;
	fragment: string;
} {
	const trimmed = href.trim();
	const idx = trimmed.indexOf("#");
	if (idx < 0) return { path: trimmed, fragment: "" };
	return { path: trimmed.slice(0, idx), fragment: trimmed.slice(idx + 1) };
}

/** Strip zero-width / BOM noise that paste or LLM output often leaves on URLs. */
export function cleanCitationHref(href: string): string {
	return (
		href
			.trim()
			.replace(/^<|>$/g, "")
			.replace(/[\u200B-\u200D\uFEFF]/g, "")
			// Streamdown's rehype-harden only treats paths starting with `/` `./` `../`
			// as relative; we may prefix `./` for rendering — strip it before jumps.
			.replace(/^\.\//, "")
	);
}

/**
 * True when `href` is a vault-relative citation that should jump via
 * `openCitation` (e.g. `papers/a/a.pdf#page=1`).
 */
export function isAgentCitationHref(href: string): boolean {
	const { path, fragment } = splitCitationHref(cleanCitationHref(href));
	if (!path || !fragment) return false;
	if (/^https?:\/\//i.test(path)) return false;
	const key = fragment.split("=", 1)[0]?.trim().toLowerCase();
	if (!key || !CITATION_FRAGMENT_KEYS.has(key)) return false;
	return path.includes("/") || /\.(pdf|tex|ltx|md)$/i.test(path);
}

/**
 * Build a citation href from a wiki nav path + heading fragment when the
 * heading is actually a citation key=value (e.g. path=`…/a.pdf`, heading=`page=1`).
 */
export function citationHrefFromWikiParts(
	path: string | null | undefined,
	fragment?: { kind: string; path?: string[] } | null,
): string | null {
	if (!path?.trim()) return null;
	if (fragment?.kind !== "heading" || !fragment.path?.length) return null;
	const frag = fragment.path.join("#");
	const key = frag.split("=", 1)[0]?.trim().toLowerCase();
	if (!key || !CITATION_FRAGMENT_KEYS.has(key)) return null;
	const clean = path.replace(/\\/g, "/").replace(/^\/+/, "");
	return `${clean}#${frag}`;
}

/**
 * Infer the paper folder vault-relative path from a file under that paper
 * (e.g. `papers/a/source/x.tex` → `papers/a`, `papers/a/a.pdf` → `papers/a`).
 */
export function paperDirFromCitationPath(path: string): string | null {
	const norm = path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
	if (!norm) return null;
	const sourceIdx = norm.toLowerCase().indexOf("/source/");
	if (sourceIdx >= 0) return norm.slice(0, sourceIdx);
	const marksIdx = norm.toLowerCase().indexOf("/marks/");
	if (marksIdx >= 0) return norm.slice(0, marksIdx);
	const assetsIdx = norm.toLowerCase().indexOf("/assets/");
	if (assetsIdx >= 0) return norm.slice(0, assetsIdx);
	// papers/<shelf>/<id>/<file>
	const parts = norm.split("/");
	if (parts.length >= 3 && parts[0] === "papers") {
		const last = parts[parts.length - 1] ?? "";
		if (last.includes(".")) return parts.slice(0, -1).join("/");
	}
	if (
		parts.length >= 2 &&
		parts[0] === "papers" &&
		!parts[parts.length - 1]?.includes(".")
	) {
		return norm;
	}
	return null;
}

/**
 * Rewrite TeX/LTX citation targets to `{paper}/{id}.pdf`, preserving fragments.
 * Non-TeX hrefs are returned unchanged.
 */
export function rewriteCitationHrefToPdf(href: string): string {
	const cleaned = cleanCitationHref(href);
	const { path, fragment } = splitCitationHref(cleaned);
	if (!TEX_EXT.test(path)) return cleaned;
	const paperDir = paperDirFromCitationPath(path);
	if (!paperDir) return cleaned;
	const id = paperDir.split("/").filter(Boolean).pop();
	if (!id) return cleaned;
	const pdf = `${paperDir}/${id}.pdf`;
	return fragment ? `${pdf}#${fragment}` : pdf;
}

/**
 * Strip agent-authored status tags like `introduction.tex [blocked]` that
 * clutter the bubble and are not valid citation targets.
 */
export function stripCitationStatusTags(text: string): string {
	return text.replace(STATUS_TAG, "");
}

/**
 * True when the markdown link label is only a status word (`blocked`, …).
 * Agents still emit `[blocked](papers/…)` when a read was denied under
 * Restricted ACP permissions — the pill should show the path, not "blocked".
 */
export function isCitationStatusLabel(label: string): boolean {
	return STATUS_LINK_LABELS.has(label.trim().toLowerCase());
}

/** Human pill label derived from a citation href (basename + fragment). */
export function citationLabelFromHref(href: string): string {
	const cleaned = cleanCitationHref(href);
	if (!cleaned || cleaned === "streamdown:incomplete-link") return cleaned;
	const { path, fragment } = splitCitationHref(cleaned);
	const base =
		path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || path;
	if (!fragment) return base || cleaned;
	const eq = fragment.indexOf("=");
	if (eq < 0) return `${base} · ${fragment}`;
	const key = fragment.slice(0, eq).trim().toLowerCase();
	const value = fragment.slice(eq + 1).trim();
	if (key === "page" && value) return `${base} · p.${value}`;
	if (value) return `${base} · ${key}=${value}`;
	return base || cleaned;
}
