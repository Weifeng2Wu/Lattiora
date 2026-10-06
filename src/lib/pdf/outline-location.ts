/**
 * Map a PDF annotation position (page + optional y) to an outline breadcrumb
 * using the document bookmark tree.
 */

import type { PdfBookmarkObject } from "@embedpdf/models";

import { bookmarkPageIndex } from "@/lib/pdf/bookmark";

export type OutlineLocationEntry = {
	/** Nested titles from root to this bookmark. */
	titlePath: string[];
	/** 1-based page number. */
	page: number;
	/**
	 * Optional 0–1 top-down y on the page when the destination exposes a top
	 * coordinate and page height is known. Absent for most bookmarks.
	 */
	y?: number;
};

export type AnnotationLocationInput = {
	/** 1-based page. */
	page: number;
	/**
	 * 0–1 top-down y of the annotation (min of rect tops). When omitted,
	 * matching is page-only.
	 */
	y?: number;
};

/** Depth-first flatten of the PDF outline with 1-based pages. */
export function flattenOutline(
	nodes: PdfBookmarkObject[],
	parentPath: string[] = [],
): OutlineLocationEntry[] {
	const out: OutlineLocationEntry[] = [];
	for (const node of nodes) {
		const title = (node.title ?? "").trim();
		const path = title ? [...parentPath, title] : parentPath;
		const pageIndex = bookmarkPageIndex(node);
		if (pageIndex != null && path.length) {
			const entry: OutlineLocationEntry = {
				titlePath: path,
				page: pageIndex + 1,
			};
			const y = bookmarkTopNormalized(node);
			if (y != null) entry.y = y;
			out.push(entry);
		}
		if (node.children?.length) {
			out.push(...flattenOutline(node.children, path));
		}
	}
	return out;
}

/**
 * Best-effort 0–1 y from destination "top" when present.
 * Most EmbedPDF destinations only expose pageIndex; page-only matching is MVP.
 */
function bookmarkTopNormalized(_node: PdfBookmarkObject): number | undefined {
	return undefined;
}

/**
 * Deepest outline entry that still starts at or before the annotation page
 * (and y when both sides have it). Returns null when outline is empty or no
 * bookmark precedes the annotation.
 */
export function locationPathForAnnotation(
	outline: PdfBookmarkObject[],
	location: AnnotationLocationInput,
): string[] | null {
	const flat = flattenOutline(outline);
	if (!flat.length) return null;
	const page = Math.max(1, Math.floor(location.page));
	const y =
		typeof location.y === "number" && Number.isFinite(location.y)
			? Math.min(1, Math.max(0, location.y))
			: undefined;

	let best: OutlineLocationEntry | null = null;
	for (const entry of flat) {
		if (entry.page > page) continue;
		if (entry.page < page) {
			best = entry;
			continue;
		}
		// Same page: prefer last bookmark with y <= annotation y when both set.
		if (y != null && entry.y != null) {
			if (entry.y <= y + 1e-6) best = entry;
			continue;
		}
		// Same page, no y: last bookmark on this page that starts here.
		best = entry;
	}
	return best?.titlePath.length ? best.titlePath : null;
}

/** Display string for a title path, e.g. `Method › Training`. */
export function formatOutlineLocationPath(
	titlePath: string[] | null | undefined,
	separator = " › ",
): string | null {
	if (!titlePath?.length) return null;
	const parts = titlePath
		.map((p) => p.replace(/\s+/g, " ").trim())
		.filter(Boolean);
	return parts.length ? parts.join(separator) : null;
}

// --- paper-scoped in-memory outline cache (filled by PdfViewer) ---

const outlineByPaperKey = new Map<string, PdfBookmarkObject[]>();
const outlineListeners = new Map<string, Set<() => void>>();

function paperOutlineKey(paperAbsOrRel: string): string {
	return paperAbsOrRel.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Store outline for a paper (absolute or vault-relative path key). */
export function setPaperOutline(
	paperKey: string,
	bookmarks: PdfBookmarkObject[],
): void {
	const key = paperOutlineKey(paperKey);
	if (!key) return;
	outlineByPaperKey.set(key, bookmarks);
	const listeners = outlineListeners.get(key);
	if (listeners) {
		for (const listener of listeners) listener();
	}
}

export function getPaperOutline(
	paperKey: string,
): PdfBookmarkObject[] | undefined {
	const key = paperOutlineKey(paperKey);
	if (!key) return undefined;
	return outlineByPaperKey.get(key);
}

export function subscribePaperOutline(
	paperKey: string,
	listener: () => void,
): () => void {
	const key = paperOutlineKey(paperKey);
	if (!key) return () => {};
	const set = outlineListeners.get(key) ?? new Set();
	set.add(listener);
	outlineListeners.set(key, set);
	return () => {
		set.delete(listener);
		if (!set.size) outlineListeners.delete(key);
	};
}

/** Resolve breadcrumb for an annotation using the in-memory outline cache. */
export function outlineLocationLabelForPaper(
	paperKey: string,
	location: AnnotationLocationInput,
): string | null {
	const outline = getPaperOutline(paperKey);
	if (!outline?.length) return null;
	return formatOutlineLocationPath(
		locationPathForAnnotation(outline, location),
	);
}
