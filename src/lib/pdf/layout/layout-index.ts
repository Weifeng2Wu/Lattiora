/**
 * Sidebar-aligned layout index for CLI / Agent.
 *
 * Written next to `source/layout.json` as `source/layout-index.json`.
 * Items match the Figures rail: post-merge hosts + score/NMS gates.
 */
import { LAYOUT_SIDEBAR_MIN_SCORE } from "@/lib/pdf/layout/constants";
import { dedupeLayoutRegions } from "@/lib/pdf/layout/dedupe";
import {
	isAlgorithmLayoutKind,
	isFigureLayoutKind,
	isFormulaLayoutKind,
	isSidebarLayoutKind,
	isTableLayoutKind,
} from "@/lib/pdf/layout/labels";
import {
	compareLayoutReadingOrder,
	formulaSortAnchor,
} from "@/lib/pdf/layout/merge-captions";
import type { PdfLayoutRegion } from "@/lib/pdf/layout/types";

export const LAYOUT_INDEX_SCHEMA_VERSION = 1;
export const LAYOUT_INDEX_FILE = "layout-index.json";

/** Sidebar section keys (figure = image + chart). */
export type LayoutIndexSection = "figure" | "table" | "algorithm" | "formula";

export type LayoutIndexKind =
	| "image"
	| "chart"
	| "table"
	| "algorithm"
	| "formula";

export type LayoutIndexBbox = {
	x: number;
	y: number;
	w: number;
	h: number;
};

export type LayoutIndexItem = {
	/** CLI-friendly id (stable-ish; may get -2 suffix on collision). */
	id: string;
	/** Rebuild key: page + section + title or bbox fingerprint. */
	stableKey: string;
	kind: LayoutIndexKind;
	section: LayoutIndexSection;
	/** 1-based page (mark / user convention). */
	page: number;
	/** 0-based page index (layout / EmbedPDF). */
	pageIndex: number;
	/** Normalized 0–1 page box (same as selection / visual marks). */
	bbox: LayoutIndexBbox;
	score: number;
	title?: string;
	/** Original post-merge `PdfLayoutRegion.id`. */
	layoutRegionId: string;
};

export type LayoutIndexSidecar = {
	schemaVersion: number;
	source: {
		mode: "sidebar";
		from: "layout.json";
		generatedAt: string;
		minScore: number;
	};
	items: LayoutIndexItem[];
};

function sectionOf(kind: LayoutIndexKind): LayoutIndexSection {
	if (kind === "image" || kind === "chart") return "figure";
	if (kind === "table") return "table";
	if (kind === "algorithm") return "algorithm";
	return "formula";
}

function sanitizeId(raw: string): string {
	const s = raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	return s || "region";
}

/** Prefer Figure/Table/Algorithm N from caption text. */
export function slugFromTitle(
	title: string,
	section: LayoutIndexSection,
): string | null {
	const t = title.trim();
	if (!t) return null;
	const fig = t.match(/^(?:figure|fig\.?)\s*(\d+)\b/i);
	if (fig && section === "figure") return `figure-${fig[1]}`;
	const table = t.match(/^table\s*(\d+)\b/i);
	if (table && section === "table") return `table-${table[1]}`;
	const alg = t.match(/^(?:algorithm|alg\.?)\s*(\d+)\b/i);
	if (alg && section === "algorithm") return `algorithm-${alg[1]}`;
	const eq = t.match(/^\(?(\d{1,3})\)?$/);
	if (eq && section === "formula") return `formula-${eq[1]}`;
	return null;
}

function bboxFingerprint(bbox: LayoutIndexBbox): string {
	const f = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : "0");
	return `${f(bbox.x)}_${f(bbox.y)}_${f(bbox.w)}_${f(bbox.h)}`;
}

function byPageReadingOrder(a: PdfLayoutRegion, b: PdfLayoutRegion): number {
	return a.pageIndex - b.pageIndex || a.readingOrder - b.readingOrder;
}

/**
 * Build sidebar-aligned index items from **post-merge** regions
 * (same set as Figures rail / hover targets).
 */
export function buildLayoutIndexItems(
	mergedRegions: readonly PdfLayoutRegion[],
	minScore: number = LAYOUT_SIDEBAR_MIN_SCORE,
): LayoutIndexItem[] {
	const sidebarOnly = mergedRegions.filter((r) => isSidebarLayoutKind(r.kind));
	const gallery = dedupeLayoutRegions(sidebarOnly, { minScore });

	const figures = gallery
		.filter((r) => isFigureLayoutKind(r.kind))
		.slice()
		.sort(byPageReadingOrder);
	const tables = gallery
		.filter((r) => isTableLayoutKind(r.kind))
		.slice()
		.sort(byPageReadingOrder);
	const algorithms = gallery
		.filter((r) => isAlgorithmLayoutKind(r.kind))
		.slice()
		.sort(byPageReadingOrder);
	const formulas = gallery
		.filter((r) => isFormulaLayoutKind(r.kind))
		.slice()
		.sort((a, b) => compareLayoutReadingOrder(a, b, formulaSortAnchor));

	const ordered = [...figures, ...tables, ...algorithms, ...formulas];
	const usedIds = new Set<string>();
	const items: LayoutIndexItem[] = [];

	for (const r of ordered) {
		if (!isSidebarLayoutKind(r.kind)) continue;
		const kind = r.kind;
		const section = sectionOf(kind);
		const page = Math.max(1, Math.floor(r.pageIndex) + 1);
		const title = r.title?.trim() || undefined;
		const fromTitle = title ? slugFromTitle(title, section) : null;
		const baseId = sanitizeId(
			fromTitle ??
				`${section}-p${page}-${bboxFingerprint(r.bbox).replace(/\./g, "")}`,
		);
		let id = baseId;
		let n = 2;
		while (usedIds.has(id)) {
			id = `${baseId}-${n}`;
			n += 1;
		}
		usedIds.add(id);

		const stableKey = title
			? `p${page}:${section}:${title.replace(/\s+/g, " ").slice(0, 80)}`
			: `p${page}:${section}:${bboxFingerprint(r.bbox)}`;

		items.push({
			id,
			stableKey,
			kind,
			section,
			page,
			pageIndex: Math.max(0, Math.floor(r.pageIndex)),
			bbox: {
				x: r.bbox.x,
				y: r.bbox.y,
				w: r.bbox.w,
				h: r.bbox.h,
			},
			score: r.score,
			title,
			layoutRegionId: r.id,
		});
	}

	return items;
}

export function buildLayoutIndexSidecar(
	mergedRegions: readonly PdfLayoutRegion[],
	opts?: { generatedAt?: string; minScore?: number },
): LayoutIndexSidecar {
	const minScore = opts?.minScore ?? LAYOUT_SIDEBAR_MIN_SCORE;
	return {
		schemaVersion: LAYOUT_INDEX_SCHEMA_VERSION,
		source: {
			mode: "sidebar",
			from: "layout.json",
			generatedAt: opts?.generatedAt ?? new Date().toISOString(),
			minScore,
		},
		items: buildLayoutIndexItems(mergedRegions, minScore),
	};
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function parseBbox(value: unknown): LayoutIndexBbox | null {
	if (!isObject(value)) return null;
	const { x, y, w, h } = value;
	if (
		!isFiniteNumber(x) ||
		!isFiniteNumber(y) ||
		!isFiniteNumber(w) ||
		!isFiniteNumber(h)
	) {
		return null;
	}
	return { x, y, w, h };
}

const INDEX_KINDS = new Set<LayoutIndexKind>([
	"image",
	"chart",
	"table",
	"algorithm",
	"formula",
]);

const INDEX_SECTIONS = new Set<LayoutIndexSection>([
	"figure",
	"table",
	"algorithm",
	"formula",
]);

function parseIndexItem(value: unknown): LayoutIndexItem | null {
	if (!isObject(value)) return null;
	const {
		id,
		stableKey,
		kind,
		section,
		page,
		pageIndex,
		bbox,
		score,
		title,
		layoutRegionId,
	} = value;
	if (
		typeof id !== "string" ||
		!id ||
		typeof stableKey !== "string" ||
		typeof kind !== "string" ||
		!INDEX_KINDS.has(kind as LayoutIndexKind) ||
		typeof section !== "string" ||
		!INDEX_SECTIONS.has(section as LayoutIndexSection) ||
		!isFiniteNumber(page) ||
		!isFiniteNumber(pageIndex) ||
		!isFiniteNumber(score) ||
		typeof layoutRegionId !== "string"
	) {
		return null;
	}
	const parsedBbox = parseBbox(bbox);
	if (!parsedBbox) return null;
	const item: LayoutIndexItem = {
		id,
		stableKey,
		kind: kind as LayoutIndexKind,
		section: section as LayoutIndexSection,
		page: Math.max(1, Math.floor(page)),
		pageIndex: Math.max(0, Math.floor(pageIndex)),
		bbox: parsedBbox,
		score,
		layoutRegionId,
	};
	if (typeof title === "string" && title.trim()) item.title = title.trim();
	return item;
}

/** Validate layout-index.json payload. */
export function parseLayoutIndexSidecar(
	raw: unknown,
): LayoutIndexSidecar | null {
	if (!isObject(raw)) return null;
	if (raw.schemaVersion !== LAYOUT_INDEX_SCHEMA_VERSION) return null;
	if (!isObject(raw.source) || raw.source.mode !== "sidebar") return null;
	if (raw.source.from !== "layout.json") return null;
	if (typeof raw.source.generatedAt !== "string") return null;
	if (!isFiniteNumber(raw.source.minScore)) return null;
	if (!Array.isArray(raw.items)) return null;
	const items: LayoutIndexItem[] = [];
	for (const entry of raw.items) {
		const item = parseIndexItem(entry);
		if (!item) return null;
		items.push(item);
	}
	return {
		schemaVersion: LAYOUT_INDEX_SCHEMA_VERSION,
		source: {
			mode: "sidebar",
			from: "layout.json",
			generatedAt: raw.source.generatedAt,
			minScore: raw.source.minScore,
		},
		items,
	};
}
