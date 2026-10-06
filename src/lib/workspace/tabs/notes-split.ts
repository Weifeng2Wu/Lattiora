import i18n from "@/i18n";
import { isRemoteArxivPath, notesPathForPaper } from "@/lib/paper";
import {
	createPlaceholderTab,
	isCanonicalTabIdForPath,
	normalizeTabPath,
	tabIdForPath,
} from "@/lib/workspace/tabs/model";
import type { DocTab, OpenPlacement } from "@/lib/workspace/tabs/types";

export function tabNotesEligible(tab: DocTab | null): boolean {
	if (!tab) return false;
	return (
		tab.kind !== "library" &&
		!isRemoteArxivPath(tab.path) &&
		(tab.mode === "pdf" || tab.mode === "html") &&
		Boolean(tab.paperMeta ?? tab.notesPath)
	);
}

/**
 * Paper body panel (PDF/HTML) — left column of the reading split.
 * Distinct from the NOTES.md markdown panel for the same paper.
 */
export function isPaperContentTab(tab: DocTab | null): boolean {
	return tabNotesEligible(tab);
}

/** Center Markdown mode while a paper is open edits its NOTES.md live. */
export function tabIsPaperNotes(tab: DocTab | null): boolean {
	if (tab?.mode !== "markdown" || !tab.notesPath) {
		return false;
	}
	const tabPath = normalizeTabPath(tab.path);
	const notesPath = normalizeTabPath(tab.notesPath);
	const paperDir = notesPath.replace(/\/notes\.md$/, "");
	return tabPath === notesPath || tabPath === paperDir;
}

/**
 * Anchor for stacking another NOTES panel into the right reading column.
 */
export function findNotesColumnAnchor(
	tabs: DocTab[],
	opts?: { excludeId?: string; preferId?: string | null },
): DocTab | null {
	const candidates = tabs.filter(
		(t) => t.id !== opts?.excludeId && tabIsPaperNotes(t),
	);
	if (!candidates.length) return null;
	if (opts?.preferId) {
		const preferred = candidates.find((t) => t.id === opts.preferId);
		if (preferred) return preferred;
	}
	return candidates[0] ?? null;
}

/**
 * Where to place a newly opened paper body / NOTES companion.
 *
 * Paper bodies use normal dock placement (active group / default) so multi-paper
 * layouts can split freely — they are no longer forced into a single left column.
 * NOTES still prefer an existing notes column when present; otherwise open to the
 * right of the paper (first-paper reading default).
 */
export function paperReadingPlacements(
	tabs: DocTab[],
	opts: {
		paperId: string;
		notesId?: string | null;
		/** Prefer stacking relative to the currently active panel when possible. */
		activeId?: string | null;
		/** Explicit placement from file-tree drop etc. wins for the paper body. */
		forcedPaperPlacement?: OpenPlacement;
	},
): {
	paper: OpenPlacement;
	notes: OpenPlacement;
} {
	const notesAnchor = opts.notesId
		? findNotesColumnAnchor(tabs, {
				excludeId: opts.notesId,
				preferId: opts.activeId,
			})
		: null;
	const notes: OpenPlacement = notesAnchor
		? { direction: "within", referencePanelId: notesAnchor.id }
		: { direction: "right", referencePanelId: opts.paperId };

	if (opts.forcedPaperPlacement) {
		return {
			paper: opts.forcedPaperPlacement,
			notes,
		};
	}

	// null → dockview activates existing / adds to the active group (free layout).
	return { paper: null, notes };
}

export function createNotesSplitPane(tab: DocTab): DocTab | null {
	if (!tab.notesPath) return null;
	return {
		...createPlaceholderTab(tab.notesPath, "markdown"),
		kind: "file",
		title: i18n.t("app:labels.notes"),
		paperMeta: tab.paperMeta,
		notesPath: tab.notesPath,
		notesSeed: tab.notesSeed,
		loaded: true,
	};
}

/** Whether NOTES.md for this paper is already open as a panel. */
export function tabHasNotesSplit(
	tabs: DocTab[],
	paperTab: DocTab | null,
): boolean {
	if (!paperTab?.notesPath) return false;
	const notesId = tabIdForPath(paperTab.notesPath);
	return tabs.some((t) => t.id === notesId);
}

/**
 * Open NOTES companion of a paper body (PDF/HTML). Null when the tab is not
 * a paper body or its NOTES panel is not open.
 */
export function findReadingCompanion(
	tabs: DocTab[],
	tab: DocTab | null,
): DocTab | null {
	if (!tab || !isPaperContentTab(tab) || !tab.notesPath) return null;
	if (!isCanonicalTabIdForPath(tab.id, tab.path)) return null;
	const notesId = tabIdForPath(tab.notesPath);
	return tabs.find((t) => t.id === notesId) ?? null;
}

/**
 * Panel ids to close together: closing a paper body (PDF/HTML) also closes
 * its open NOTES panel, but closing NOTES leaves the body open.
 */
export function readingPairCloseIds(tabs: DocTab[], id: string): string[] {
	const tab = tabs.find((t) => t.id === id) ?? null;
	const companion = findReadingCompanion(tabs, tab);
	if (!companion || companion.id === id) return [id];
	// Companion first so body/NOTES order is stable for tests and revoke order.
	return [companion.id, id];
}

/** Reseed an open paper tab's NOTES editor (bumps notesKey to reload in place). */
export function reseedNotesTab(
	prev: DocTab[],
	paperDir: string,
	content: string,
): DocTab[] {
	const id = tabIdForPath(paperDir);
	const notesId = tabIdForPath(notesPathForPaper(paperDir));
	return prev.map((t) => {
		if (t.id === id || t.id === notesId) {
			return {
				...t,
				notesSeed: content,
				notesDirty: false,
				notesKey: t.notesKey + 1,
			};
		}
		return t;
	});
}

/** Reseed an open plain-Markdown tab (bumps seedKey to reload in place). */
export function reseedMarkdownTab(
	prev: DocTab[],
	absPath: string,
	content: string,
): DocTab[] {
	const key = normalizeTabPath(absPath);
	return prev.map((t) => {
		if (normalizeTabPath(t.path) === key) {
			return {
				...t,
				markdownSeed: content,
				markdownDirty: false,
				seedKey: t.seedKey + 1,
			};
		}
		return t;
	});
}

/** Reseed an open Excalidraw tab after our own save (no remount). */
export function reseedExcalidrawTab(
	prev: DocTab[],
	absPath: string,
	content: string,
): DocTab[] {
	const key = normalizeTabPath(absPath);
	return prev.map((t) => {
		if (normalizeTabPath(t.path) === key && t.mode === "excalidraw") {
			return {
				...t,
				excalidrawSeed: content,
				excalidrawDirty: false,
			};
		}
		return t;
	});
}

/** Refresh an open Excalidraw tab from disk (bumps key to force remount). */
export function refreshExcalidrawTab(
	prev: DocTab[],
	absPath: string,
	content: string,
): DocTab[] {
	const key = normalizeTabPath(absPath);
	return prev.map((t) => {
		if (normalizeTabPath(t.path) === key && t.mode === "excalidraw") {
			return {
				...t,
				excalidrawSeed: content,
				excalidrawDirty: false,
				excalidrawKey: t.excalidrawKey + 1,
			};
		}
		return t;
	});
}

/** Reseed an open plain-text tab after our own save (no reload needed). */
export function reseedTextTab(
	prev: DocTab[],
	absPath: string,
	content: string,
): DocTab[] {
	const key = normalizeTabPath(absPath);
	return prev.map((t) => {
		if (normalizeTabPath(t.path) === key && t.mode === "text") {
			return { ...t, textSeed: content, textDirty: false };
		}
		return t;
	});
}

/**
 * Refresh an open plain-text tab from disk (bumps key; the editor swaps the
 * document in place — no remount, scroll and view state survive).
 */
export function refreshTextTab(
	prev: DocTab[],
	absPath: string,
	content: string,
): DocTab[] {
	const key = normalizeTabPath(absPath);
	return prev.map((t) => {
		if (normalizeTabPath(t.path) === key && t.mode === "text") {
			return {
				...t,
				textSeed: content,
				textDirty: false,
				textKey: t.textKey + 1,
			};
		}
		return t;
	});
}

/**
 * Refresh an open PDF / translation pane from disk. A fresh `pdfBytes`
 * identity is the viewer's reload signal (EmbedPDF re-inits on the new
 * buffer); panes the TeX compile flow owns (`texCompiling`) are skipped —
 * openTexPdf fills those itself when the run lands.
 */
export function refreshPdfTab(
	prev: DocTab[],
	absPath: string,
	bytes: ArrayBuffer,
): DocTab[] {
	const key = normalizeTabPath(absPath);
	return prev.map((t) => {
		if (
			normalizeTabPath(t.path) === key &&
			(t.mode === "pdf" || t.mode === "translation") &&
			!t.texCompiling
		) {
			return { ...t, pdfBytes: bytes, loaded: true };
		}
		return t;
	});
}

/** Keep the seed of the tab(s) owning `path` in sync after a disk write. */
export function syncTabSeedsForPath(
	prev: DocTab[],
	path: string,
	content: string,
): DocTab[] {
	const key = path.replace(/\\/g, "/").toLowerCase();
	const pathId = tabIdForPath(path);
	return prev.map((tab) => {
		const notesKey = tab.notesPath?.replace(/\\/g, "/").toLowerCase();
		if (notesKey === key) {
			return { ...tab, notesSeed: content };
		}
		if (
			tab.id === pathId ||
			normalizeTabPath(tab.path) === normalizeTabPath(path)
		) {
			const isNotes = Boolean(
				tab.notesPath &&
					normalizeTabPath(tab.path) === normalizeTabPath(tab.notesPath),
			);
			return {
				...tab,
				...(isNotes || notesKey === key
					? { notesSeed: content }
					: { markdownSeed: content }),
			};
		}
		return tab;
	});
}
