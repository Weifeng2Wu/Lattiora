/**
 * PDF visual-region drafts for the Agent composer (ephemeral).
 * Not persisted — consumed on submit, independent of text selection-store.
 */

import { createStore } from "zustand/vanilla";

import type { PromptImage } from "@/lib/agent/api";
import { toVaultRelative } from "@/lib/core/path";
import { newTraceId } from "@/lib/pdf-visual/ids";
import type { PdfVisualNormalizedRect } from "@/lib/pdf-visual/types";
import { vaultStore } from "@/lib/vault/store";

export type PdfVisualDraft = {
	id: string;
	/** Vault-relative paper path when known. */
	paperPath: string;
	/** Absolute paper path for crop/write helpers at runtime only. */
	paperAbsPath?: string;
	/** 1-based PDF page number. */
	page: number;
	rects: PdfVisualNormalizedRect[];
	comment: string;
	/** Crop used for composer thumbnails and runOnce images. */
	image: PromptImage;
};

type VisualContextStore = {
	drafts: PdfVisualDraft[];
};

const MAX_DRAFTS = 12;
const MAX_COMMENT_CHARS = 2000;

export const visualContextStore = createStore<VisualContextStore>(() => ({
	drafts: [],
}));

function normalizeComment(comment: string): string {
	return comment.trim().slice(0, MAX_COMMENT_CHARS);
}

function resolvePaperPath(sourcePath: string): string {
	return toVaultRelative(vaultStore.getState().vaultPath, sourcePath);
}

/**
 * Add a visual annotation draft (image + optional comment). A draft id is the
 * mark id, so one mark is at most one composer entry: re-adding an id that is
 * already queued refreshes that entry in place instead of stacking duplicates
 * (which shared a React key and removed together).
 */
export function addVisualDraft(input: {
	paperPath: string;
	paperAbsPath?: string;
	page: number;
	rects: PdfVisualNormalizedRect[];
	comment?: string;
	image: PromptImage;
	id?: string;
}): PdfVisualDraft {
	const draft: PdfVisualDraft = {
		// Stable across restarts — draft id becomes marks/<id>.json on submit.
		id: input.id ?? newTraceId(),
		paperPath: resolvePaperPath(input.paperPath),
		page: Math.max(1, Math.floor(input.page)),
		rects: input.rects,
		comment: normalizeComment(input.comment ?? ""),
		image: {
			data: input.image.data,
			mimeType: input.image.mimeType || "image/png",
		},
	};
	if (input.paperAbsPath?.trim()) {
		draft.paperAbsPath = input.paperAbsPath.trim();
	}
	const { drafts } = visualContextStore.getState();
	const existing = drafts.findIndex((d) => d.id === draft.id);
	visualContextStore.setState({
		drafts:
			existing >= 0
				? drafts.map((d, i) => (i === existing ? draft : d))
				: [...drafts, draft].slice(-MAX_DRAFTS),
	});
	return draft;
}

/** Update comment text for an existing draft. */
export function updateVisualDraftComment(id: string, comment: string): boolean {
	const { drafts } = visualContextStore.getState();
	const index = drafts.findIndex((d) => d.id === id);
	if (index < 0) return false;
	const next = [...drafts];
	next[index] = { ...next[index], comment: normalizeComment(comment) };
	visualContextStore.setState({ drafts: next });
	return true;
}

/** Remove one draft by id. */
export function removeVisualDraft(id: string): void {
	const { drafts } = visualContextStore.getState();
	if (!drafts.some((d) => d.id === id)) return;
	visualContextStore.setState({
		drafts: drafts.filter((d) => d.id !== id),
	});
}

/** Current drafts in insertion order. */
export function currentVisualDrafts(): PdfVisualDraft[] {
	return visualContextStore.getState().drafts;
}

/** Snapshot and clear — a submitted turn consumes its visual drafts. */
export function consumeVisualDrafts(): PdfVisualDraft[] {
	const all = currentVisualDrafts();
	if (all.length) visualContextStore.setState({ drafts: [] });
	return all;
}

/** Drop every draft without consuming. */
export function clearVisualDrafts(): void {
	if (!visualContextStore.getState().drafts.length) return;
	visualContextStore.setState({ drafts: [] });
}

/**
 * Group drafts by paperPath for per-paper trace writes that still share
 * one Agent session.
 */
export function groupVisualDraftsByPaper(
	drafts: PdfVisualDraft[],
): Map<string, PdfVisualDraft[]> {
	const groups = new Map<string, PdfVisualDraft[]>();
	for (const draft of drafts) {
		const key = draft.paperPath || draft.paperAbsPath || "";
		const list = groups.get(key) ?? [];
		list.push(draft);
		groups.set(key, list);
	}
	return groups;
}
