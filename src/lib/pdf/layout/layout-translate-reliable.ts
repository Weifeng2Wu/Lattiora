/**
 * Reliability layer for PDF layout translation.
 *
 * The legacy runner already owns provider/session integration and paragraph
 * batching. This module keeps that behaviour, but fixes two correctness gaps:
 * layout source text is never truncated, and oversized/failed units are split
 * and retried before the UI is told that the job is complete.
 */

import { errorText } from "@/lib/core/error";
import { LAYOUT_SIDEBAR_MIN_SCORE } from "@/lib/pdf/layout/constants";
import {
	isAlgorithmLayoutKind,
	isLayoutTranslatableKind,
} from "@/lib/pdf/layout/labels";
import {
	isAlgorithmTitleText,
	isAsideTextLayoutLabel,
	isInsideAlgorithmRegion,
	isReferenceLayoutLabel,
	isReferenceSectionTitle,
	layoutRegionSourceText,
	runLayoutRegionTranslate as runLegacyLayoutRegionTranslate,
} from "@/lib/pdf/layout/layout-translate";
import { normalizeLayoutSourceText } from "@/lib/pdf/layout/layout-translate-source";
import type {
	LayoutTranslateItem,
	LayoutTranslateRegion,
	PdfLayoutRegion,
} from "@/lib/pdf/layout/types";

export {
	applyLayoutTranslateSidecar,
	currentLayoutTranslateCacheKey,
	groupLayoutTranslateItemsByPage,
	hasPendingLayoutTranslateItems,
	LAYOUT_TRANSLATE_CONCURRENCY,
	LAYOUT_TRANSLATE_SIDECAR_FILE,
	LAYOUT_TRANSLATE_SIDECAR_SCHEMA_VERSION,
	type LayoutTranslateCacheKey,
	type LayoutTranslateSidecar,
	type LayoutTranslateSidecarItem,
	layoutRegionSourceText,
	layoutTranslateSidecarPath,
	parseLayoutTranslateSidecar,
	persistLayoutTranslateSidecarBestEffort,
	readLayoutTranslateSidecar,
	toLayoutTranslateItems,
	writeLayoutTranslateSidecar,
} from "@/lib/pdf/layout/layout-translate";
export type {
	LayoutTranslateItem,
	LayoutTranslateItemStatus,
	LayoutTranslateRegion,
} from "@/lib/pdf/layout/types";

/**
 * Per-request cap for one oversized layout block. Keeping chunks around 2.2k
 * characters leaves ample room below the Host 5k limit and also reduces the
 * chance that LLM-backed providers hit their output-token ceiling.
 */
export const LAYOUT_TRANSLATE_MAX_CHARS = 2200;

/** A finished job can now explicitly report that some blocks still need work. */
export type LayoutTranslateJobStatus =
	| "idle"
	/** Layout regions not parsed yet; the job auto-starts once they land. */
	| "waitingLayout"
	| "running"
	| "done"
	| "partial"
	| "cancelled";

const LONG_TEXT_BOUNDARY_WINDOW = 700;
const LAYOUT_TRANSLATE_RETRY_ROUNDS = 2;

/**
 * Split long prose without dropping a single character. Prefer sentence, then
 * clause, then whitespace boundaries; hard-cut only when the source has none.
 */
export function splitLongLayoutTranslateSource(
	text: string,
	maxChars = LAYOUT_TRANSLATE_MAX_CHARS,
): string[] {
	const source = text.trim();
	if (!source) return [];
	if (source.length <= maxChars) return [source];
	const chunks: string[] = [];
	let rest = source;
	while (rest.length > maxChars) {
		const floor = Math.max(1, maxChars - LONG_TEXT_BOUNDARY_WINDOW);
		let cut = -1;
		for (const re of [/[.!?。！？]\s/gu, /[,，、;；:：]\s/gu, /\s/gu]) {
			re.lastIndex = 0;
			let match = re.exec(rest.slice(0, maxChars + 1));
			while (match) {
				const end = match.index + match[0].length;
				if (end >= floor && end <= maxChars) cut = end;
				match = re.exec(rest.slice(0, maxChars + 1));
			}
			if (cut > 0) break;
		}
		if (cut <= 0) cut = maxChars;
		const chunk = rest.slice(0, cut).trim();
		if (chunk) chunks.push(chunk);
		rest = rest.slice(cut).trimStart();
	}
	if (rest.trim()) chunks.push(rest.trim());
	return chunks;
}

/**
 * Full reading-order source list. Unlike the legacy implementation, source is
 * preserved in full; request-size handling belongs to the runner, not extraction.
 */
export function listTranslatableLayoutRegions(
	regions: readonly PdfLayoutRegion[],
	minScore: number = LAYOUT_SIDEBAR_MIN_SCORE,
): LayoutTranslateRegion[] {
	const algorithms = regions.filter(
		(r) => isAlgorithmLayoutKind(r.kind) && r.score >= minScore,
	);
	const referenceBlocks = regions.filter(
		(r) => isReferenceLayoutLabel(r.label) && r.score >= minScore,
	);
	const out: LayoutTranslateRegion[] = [];
	for (const r of regions) {
		if (isAlgorithmLayoutKind(r.kind)) continue;
		if (isReferenceLayoutLabel(r.label)) continue;
		if (isAsideTextLayoutLabel(r.label)) continue;
		if (!isLayoutTranslatableKind(r.kind)) continue;
		if (!(r.score >= minScore)) continue;
		if (!(r.bbox.w > 0 && r.bbox.h > 0)) continue;
		if (isInsideAlgorithmRegion(r, algorithms)) continue;
		if (isInsideAlgorithmRegion(r, referenceBlocks)) continue;
		const source = normalizeLayoutSourceText(layoutRegionSourceText(r), r.kind);
		if (!source) continue;
		if (isAlgorithmTitleText(source)) continue;
		if (isReferenceSectionTitle(source)) continue;
		out.push({
			id: r.id,
			pageIndex: r.pageIndex,
			bbox: r.bbox,
			kind: r.kind,
			readingOrder: r.readingOrder,
			source,
		});
	}
	out.sort(
		(a, b) =>
			a.pageIndex - b.pageIndex ||
			a.readingOrder - b.readingOrder ||
			a.bbox.y - b.bbox.y ||
			a.bbox.x - b.bbox.x,
	);
	return out;
}

type ExpandedItem = LayoutTranslateItem & {
	__originalId?: string;
	__chunkIndex?: number;
	__chunkCount?: number;
};

function expandOversizedItems(
	items: readonly LayoutTranslateItem[],
): ExpandedItem[] {
	const out: ExpandedItem[] = [];
	for (const item of items) {
		if (item.status === "done" && item.translated?.trim()) {
			out.push({ ...item });
			continue;
		}
		const chunks = splitLongLayoutTranslateSource(item.source);
		if (chunks.length <= 1) {
			out.push({ ...item });
			continue;
		}
		chunks.forEach((source, index) => {
			out.push({
				...item,
				id: `__agentero_layout_chunk__${item.id}__${index}`,
				// A header is deliberately non-continuable, preventing the legacy
				// paragraph-chain builder from joining our chunks back together.
				kind: "header",
				readingOrder: item.readingOrder + index / 1000,
				source,
				translated: undefined,
				error: undefined,
				status: "pending",
				__originalId: item.id,
				__chunkIndex: index,
				__chunkCount: chunks.length,
			});
		});
	}
	return out;
}

function collapseExpandedItems(
	template: readonly LayoutTranslateItem[],
	expanded: readonly ExpandedItem[],
): LayoutTranslateItem[] {
	const direct = new Map(
		expanded.filter((it) => !it.__originalId).map((it) => [it.id, it]),
	);
	const chunksByOriginal = new Map<string, ExpandedItem[]>();
	for (const item of expanded) {
		if (!item.__originalId) continue;
		const bucket = chunksByOriginal.get(item.__originalId) ?? [];
		bucket.push(item);
		chunksByOriginal.set(item.__originalId, bucket);
	}
	return template.map((original) => {
		const chunks = chunksByOriginal.get(original.id);
		if (!chunks?.length) return { ...(direct.get(original.id) ?? original) };
		chunks.sort((a, b) => (a.__chunkIndex ?? 0) - (b.__chunkIndex ?? 0));
		const allDone = chunks.every(
			(chunk) => chunk.status === "done" && chunk.translated?.trim(),
		);
		if (allDone) {
			return {
				...original,
				status: "done",
				translated: chunks
					.map((chunk) => chunk.translated?.trim() ?? "")
					.filter(Boolean)
					.join(" "),
				error: undefined,
			};
		}
		const running = chunks.some((chunk) => chunk.status === "running");
		const failed = chunks.find((chunk) => chunk.status === "error");
		const skipped = chunks.some((chunk) => chunk.status === "skipped");
		return {
			...original,
			status: running
				? "running"
				: failed
					? "error"
					: skipped
						? "skipped"
						: "pending",
			translated: running
				? chunks
						.map((chunk) => chunk.translated?.trim() ?? "")
						.filter(Boolean)
						.join(" ") || undefined
				: undefined,
			error: failed?.error,
		};
	});
}

function mergeExpandedPass(
	current: readonly ExpandedItem[],
	updates: readonly LayoutTranslateItem[],
): ExpandedItem[] {
	const byId = new Map(updates.map((item) => [item.id, item]));
	return current.map((item) => {
		const update = byId.get(item.id);
		return update ? { ...item, ...update } : { ...item };
	});
}

/**
 * Reliable wrapper around the existing provider-aware runner. It translates
 * oversized blocks as safe chunks, then retries terminal errors individually so
 * one transient batch failure cannot leave a large part of a page untranslated.
 */
export async function runLayoutRegionTranslate(options: {
	items: LayoutTranslateItem[];
	signal?: AbortSignal;
	concurrency?: number;
	onUpdate: (items: LayoutTranslateItem[]) => void;
	paperKey?: string | null;
	vaultPath?: string | null;
}): Promise<LayoutTranslateItem[]> {
	const template = options.items.map((item) => ({ ...item }));
	let expanded = expandOversizedItems(template);
	const publish = () =>
		options.onUpdate(collapseExpandedItems(template, expanded));

	const runPass = async (
		seed: ExpandedItem[],
		concurrency: number | undefined,
	): Promise<ExpandedItem[]> => {
		const result = await runLegacyLayoutRegionTranslate({
			items: seed.map((item) => ({ ...item })),
			signal: options.signal,
			concurrency,
			paperKey: options.paperKey,
			vaultPath: options.vaultPath,
			onUpdate: (next) => {
				expanded = mergeExpandedPass(expanded, next);
				publish();
			},
		});
		return result.map((item) => {
			const meta = seed.find((candidate) => candidate.id === item.id);
			return { ...meta, ...item };
		});
	};

	try {
		const first = await runPass(expanded, options.concurrency);
		expanded = mergeExpandedPass(expanded, first);
	} catch (error) {
		if (options.signal?.aborted)
			return collapseExpandedItems(template, expanded);
		// Resolver/session setup can fail before the legacy runner paints item
		// errors. Mark the current pending set so the hook reports partial, not done.
		expanded = expanded.map((item) =>
			item.status === "done"
				? item
				: { ...item, status: "error", error: errorText(error) },
		);
		publish();
		return collapseExpandedItems(template, expanded);
	}

	for (let round = 0; round < LAYOUT_TRANSLATE_RETRY_ROUNDS; round++) {
		if (options.signal?.aborted) break;
		const failed = expanded
			.filter((item) => item.status === "error")
			.map((item) => ({
				...item,
				status: "pending" as const,
				translated: undefined,
				error: undefined,
			}));
		if (failed.length === 0) break;
		// Retry failures as individual units. This is intentionally serialized:
		// it avoids repeating the same rate-limit/batch failure pattern.
		for (const item of failed) {
			if (options.signal?.aborted) break;
			try {
				const retried = await runPass([item], 1);
				expanded = mergeExpandedPass(expanded, retried);
			} catch (error) {
				expanded = expanded.map((current) =>
					current.id === item.id
						? { ...current, status: "error", error: errorText(error) }
						: current,
				);
			}
			publish();
		}
	}

	return collapseExpandedItems(template, expanded);
}
