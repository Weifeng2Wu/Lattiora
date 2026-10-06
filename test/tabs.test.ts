import { beforeEach, describe, expect, it, vi } from "vitest";
import * as tauri from "@/lib/core/tauri";
import { LIBRARY_VIRTUAL_PATH } from "@/lib/paper/api";
import { vaultStore } from "@/lib/vault/store";
import {
	closeTab,
	handleActivePanelChange,
	hydratePlaceholderTabs,
	openTab,
	openTranslationTab,
	setNotesSplit,
	syncUpdatedPaperTabs,
} from "@/lib/workspace/actions";
import {
	type DockHandle,
	registerDockHandle,
} from "@/lib/workspace/dock-registry";
import {
	getActiveTabId,
	getTabs,
	setActiveTabId,
	setTabs,
} from "@/lib/workspace/store";
import {
	createNotesSplitPane,
	createPlaceholderTab,
	type DocTab,
	extractTabsFromLayout,
	insertPlaceholderTab,
	loadPersistedTabs,
	panelPersistParams,
	paperReadingPlacements,
	patchFromTabResources,
	patchTab,
	readingPairCloseIds,
	remapPathUnder,
	remapTabsUnderPath,
	removeTab,
	removeTabsUnderPath,
	reseedMarkdownTab,
	reseedNotesTab,
	savePersistedTabs,
	syncTabSeedsForPath,
	type TabResources,
	tabHasNotesSplit,
	tabIsPaperNotes,
	tabNotesEligible,
} from "@/lib/workspace/tabs";
import * as tabResources from "@/lib/workspace/tabs/resources";

function makeTab(path: string, overrides: Partial<DocTab> = {}): DocTab {
	return { ...createPlaceholderTab(path), ...overrides };
}

function makeResources(overrides: Partial<TabResources> = {}): TabResources {
	return {
		kind: "paper",
		title: "A Paper",
		mode: "pdf",
		paperMeta: null,
		pdfUrl: null,
		pdfBytes: null,
		htmlUrl: null,
		imageUrl: null,
		notesPath: "/vault/papers/a/NOTES.md",
		notesSeed: "",
		markdownSeed: "",
		loaded: true,
		...overrides,
	};
}

describe("createPlaceholderTab", () => {
	it("builds an unloaded placeholder from a normalized id", () => {
		const tab = createPlaceholderTab("/vault/a.md", "pdf");
		expect(tab.id).toBe("/vault/a.md");
		expect(tab.kind).toBe("file");
		expect(tab.title).toBe("a.md");
		expect(tab.mode).toBe("pdf");
		expect(tab.loaded).toBe(false);
	});

	it("special-cases the Library virtual path", () => {
		const tab = createPlaceholderTab(LIBRARY_VIRTUAL_PATH);
		expect(tab.path).toBe(LIBRARY_VIRTUAL_PATH);
		expect(tab.kind).toBe("library");
		expect(tab.title).toBe("Library");
		expect(tab.mode).toBe("markdown");
	});
});

it("restores a dotted paper folder only after the tree identifies its owner", async () => {
	const path = "/vault/papers/topic/2606.04046";
	const tab = makeTab(path, { mode: "pdf" });
	const previousVault = vaultStore.getState();
	const previousTabs = getTabs();
	vi.spyOn(tauri, "isTauri").mockReturnValue(true);
	const load = vi
		.spyOn(tabResources, "loadTabResources")
		.mockResolvedValue(makeResources({ notesPath: null }));
	try {
		vaultStore.setState({
			vaultPath: "/vault",
			tree: [],
			paperFolders: [],
			treeLoading: true,
		});
		setTabs([tab]);
		hydratePlaceholderTabs([tab.id]);
		expect(load).not.toHaveBeenCalled();

		vaultStore.setState({ treeLoading: false, paperFolders: [path] });
		hydratePlaceholderTabs([tab.id]);
		await vi.waitFor(() => expect(getTabs()[0]?.loaded).toBe(true));
		expect(load).toHaveBeenCalledExactlyOnceWith(path, "/vault", [], [path]);
	} finally {
		vi.restoreAllMocks();
		vaultStore.setState(previousVault);
		setTabs(previousTabs);
	}
});

describe("insertPlaceholderTab", () => {
	it("appends a new tab", () => {
		const { tabs, id, exists } = insertPlaceholderTab([], "/vault/a.md");
		expect(exists).toBe(false);
		expect(id).toBe("/vault/a.md");
		expect(tabs).toHaveLength(1);
	});

	it("dedupes by id and returns the original array", () => {
		const start = [makeTab("/vault/a.md")];
		const { tabs, exists } = insertPlaceholderTab(start, "/Vault/A.md");
		expect(exists).toBe(true);
		expect(tabs).toBe(start);
	});
});

describe("patchTab", () => {
	it("merges the patch into the matching tab only", () => {
		const start = [makeTab("/vault/a.md"), makeTab("/vault/b.md")];
		const next = patchTab(start, "/vault/a.md", { loaded: true, title: "A" });
		expect(next[0]?.loaded).toBe(true);
		expect(next[0]?.title).toBe("A");
		expect(next[1]?.loaded).toBe(false);
	});
});

describe("patchFromTabResources", () => {
	const probeMissed = makeResources({ mode: "markdown", pdfBytes: null });

	it("keeps pdf mode for a paper tab when the PDF probe missed once", () => {
		// Restored / reopened placeholder: kind "file" until hydration resolves.
		const placeholder = makeTab("/vault/papers/a", { mode: "pdf" });
		const patch = patchFromTabResources(probeMissed, placeholder);
		expect(patch.mode).toBe("pdf");
		expect(patch.kind).toBe("paper");
		expect(patch.loaded).toBe(true);
		expect(patch.seedKey).toBe(1);
	});

	it("keeps pdf mode for an already-loaded paper tab on rehydrate", () => {
		const loadedPaper = makeTab("/vault/papers/a", {
			kind: "paper",
			mode: "pdf",
			loaded: true,
		});
		expect(patchFromTabResources(probeMissed, loadedPaper).mode).toBe("pdf");
	});

	it("applies the loaded mode when the tab has no pdf intent to preserve", () => {
		const markdownTab = makeTab("/vault/papers/a", { mode: "markdown" });
		expect(patchFromTabResources(probeMissed, markdownTab).mode).toBe(
			"markdown",
		);
	});

	it("does not second-guess a non-markdown fallback (e.g. remote html)", () => {
		const placeholder = makeTab("/vault/papers/a", { mode: "pdf" });
		const htmlFallback = makeResources({
			mode: "html",
			htmlUrl: "https://arxiv.org/html/2508.05004",
		});
		expect(patchFromTabResources(htmlFallback, placeholder).mode).toBe("html");
	});

	it("passes resource fields through", () => {
		const res = makeResources({
			title: "A Paper",
			notesPath: "/vault/papers/a/NOTES.md",
			notesSeed: "# Notes\n",
			markdownSeed: "",
		});
		const patch = patchFromTabResources(res, null);
		expect(patch.title).toBe("A Paper");
		expect(patch.notesPath).toBe("/vault/papers/a/NOTES.md");
		expect(patch.notesSeed).toBe("# Notes\n");
	});
});

describe("removeTab", () => {
	const start = [
		makeTab("/vault/a.md"),
		makeTab("/vault/b.md"),
		makeTab("/vault/c.md"),
	];

	it("removes by id without computing a neighbor active id", () => {
		const { tabs, removed } = removeTab(start, "/vault/b.md");
		expect(removed?.id).toBe("/vault/b.md");
		expect(tabs.map((t) => t.id)).toEqual(["/vault/a.md", "/vault/c.md"]);
	});

	it("returns empty tabs when the last panel is removed", () => {
		const { tabs, removed } = removeTab(
			[makeTab("/vault/a.md")],
			"/vault/a.md",
		);
		expect(removed?.id).toBe("/vault/a.md");
		expect(tabs).toHaveLength(0);
	});

	it("is a no-op for an unknown id", () => {
		const { tabs, removed } = removeTab(start, "/nope");
		expect(tabs).toBe(start);
		expect(removed).toBeNull();
	});
});

describe("removeTabsUnderPath", () => {
	it("removes tabs at or under the path but keeps Library", () => {
		const start = [
			makeTab(LIBRARY_VIRTUAL_PATH),
			makeTab("/vault/papers/x"),
			makeTab("/vault/papers/x/NOTES.md"),
			makeTab("/vault/other.md"),
		];
		const { tabs, removed } = removeTabsUnderPath(start, "/vault/papers/x");
		expect(tabs.map((t) => t.id)).toEqual([
			LIBRARY_VIRTUAL_PATH,
			"/vault/other.md",
		]);
		expect(removed).toHaveLength(2);
	});

	it("is a no-op when nothing matches", () => {
		const start = [makeTab("/vault/a.md")];
		const { tabs, removed } = removeTabsUnderPath(start, "/vault/z");
		expect(tabs).toBe(start);
		expect(removed).toHaveLength(0);
	});
});

describe("remapTabsUnderPath", () => {
	it("keeps moved tabs mounted and updates nested paths", () => {
		const start = [
			makeTab("/vault/papers/nlp/paper", {
				paperMeta: { path: "papers/nlp/paper" } as DocTab["paperMeta"],
				notesPath: "/vault/papers/nlp/paper/NOTES.md",
			}),
			makeTab("/vault/notes/other.md"),
		];
		const next = remapTabsUnderPath(
			start,
			"/vault/papers/nlp",
			"/vault/papers/archive/nlp",
			"papers/nlp",
			"papers/archive/nlp",
		);
		expect(next[0]?.id).toBe("/vault/papers/archive/nlp/paper");
		expect(next[0]?.notesPath).toBe("/vault/papers/archive/nlp/paper/NOTES.md");
		expect(next[0]?.paperMeta?.path).toBe("papers/archive/nlp/paper");
		expect(next[1]).toBe(start[1]);
	});

	it("leaves unrelated and virtual paths unchanged", () => {
		expect(remapPathUnder(LIBRARY_VIRTUAL_PATH, "/vault/a", "/vault/b")).toBe(
			LIBRARY_VIRTUAL_PATH,
		);
		expect(remapPathUnder("/vault/c.md", "/vault/a", "/vault/b")).toBe(
			"/vault/c.md",
		);
	});
});
describe("reseed helpers", () => {
	it("reseedNotesTab bumps notesKey and clears notesDirty", () => {
		const start = [
			makeTab("/vault/papers/x", { notesKey: 2, notesDirty: true }),
		];
		const next = reseedNotesTab(start, "/vault/papers/x", "hello");
		expect(next[0]?.notesSeed).toBe("hello");
		expect(next[0]?.notesKey).toBe(3);
		expect(next[0]?.notesDirty).toBe(false);
	});

	it("reseedMarkdownTab bumps seedKey and clears markdownDirty", () => {
		const start = [makeTab("/vault/a.md", { seedKey: 5, markdownDirty: true })];
		const next = reseedMarkdownTab(start, "/vault/a.md", "world");
		expect(next[0]?.markdownSeed).toBe("world");
		expect(next[0]?.seedKey).toBe(6);
		expect(next[0]?.markdownDirty).toBe(false);
	});
});

describe("syncTabSeedsForPath", () => {
	it("updates notesSeed when the notes path matches", () => {
		const start = [
			makeTab("/vault/papers/x", { notesPath: "/vault/papers/x/NOTES.md" }),
		];
		const next = syncTabSeedsForPath(start, "/vault/papers/x/notes.md", "n");
		expect(next[0]?.notesSeed).toBe("n");
	});

	it("updates markdownSeed when the tab path matches", () => {
		const start = [makeTab("/vault/a.md")];
		const next = syncTabSeedsForPath(start, "/VAULT/A.MD", "m");
		expect(next[0]?.markdownSeed).toBe("m");
	});
});

describe("extractTabsFromLayout", () => {
	it("reads path/mode from panel params and active from grid", () => {
		const layout = {
			grid: {
				root: {
					type: "leaf",
					data: {
						id: "g1",
						views: ["/vault/a.md", "/vault/b.md"],
						activeView: "/vault/b.md",
					},
				},
				height: 100,
				width: 100,
				orientation: "HORIZONTAL",
			},
			panels: {
				"/vault/a.md": {
					id: "/vault/a.md",
					params: {
						panelId: "/vault/a.md",
						path: "/vault/a.md",
						mode: "markdown",
					},
				},
				"/vault/b.md": {
					id: "/vault/b.md",
					params: { panelId: "/vault/b.md", path: "/vault/b.md", mode: "pdf" },
				},
			},
			activeGroup: "g1",
		};
		const extracted = extractTabsFromLayout(layout);
		expect(extracted.tabs).toEqual([
			{ id: "/vault/a.md", path: "/vault/a.md", mode: "markdown" },
			{ id: "/vault/b.md", path: "/vault/b.md", mode: "pdf" },
		]);
		expect(extracted.activeId).toBe("/vault/b.md");
	});

	it("preserves duplicate pane ids for the same path", () => {
		const layout = {
			grid: {
				root: {
					type: "branch",
					data: [
						{
							type: "leaf",
							data: {
								id: "g1",
								views: ["/vault/a.md"],
								activeView: "/vault/a.md",
							},
						},
						{
							type: "leaf",
							data: {
								id: "g2",
								views: ["/vault/a.md::pane-2"],
								activeView: "/vault/a.md::pane-2",
							},
						},
					],
				},
			},
			panels: {
				"/vault/a.md": {
					id: "/vault/a.md",
					params: {
						panelId: "/vault/a.md",
						path: "/vault/a.md",
						mode: "markdown",
					},
				},
				"/vault/a.md::pane-2": {
					id: "/vault/a.md::pane-2",
					params: {
						panelId: "/vault/a.md::pane-2",
						path: "/vault/a.md",
						mode: "markdown",
					},
				},
			},
			activeGroup: "g2",
		};
		const extracted = extractTabsFromLayout(layout);
		expect(extracted.tabs).toEqual([
			{ id: "/vault/a.md", path: "/vault/a.md", mode: "markdown" },
			{
				id: "/vault/a.md::pane-2",
				path: "/vault/a.md",
				mode: "markdown",
			},
		]);
		expect(extracted.activeId).toBe("/vault/a.md::pane-2");
	});

	it("falls back to panel id as path when params are missing", () => {
		const layout = {
			panels: {
				"/vault/x.md": { id: "/vault/x.md" },
			},
		};
		const extracted = extractTabsFromLayout(layout);
		expect(extracted.tabs).toEqual([
			{ id: "/vault/x.md", path: "/vault/x.md", mode: "markdown" },
		]);
	});

	it("carries persisted titles for restore before hydration (#410)", () => {
		const layout = {
			panels: {
				"/vault/papers/x": {
					id: "/vault/papers/x",
					params: {
						panelId: "/vault/papers/x",
						path: "/vault/papers/x",
						mode: "pdf",
						title: "Attention Is All You Need",
					},
				},
			},
		};
		const extracted = extractTabsFromLayout(layout);
		expect(extracted.tabs).toEqual([
			{
				id: "/vault/papers/x",
				path: "/vault/papers/x",
				mode: "pdf",
				title: "Attention Is All You Need",
			},
		]);
	});
});

describe("panelPersistParams", () => {
	it("round-trips the display title into layout params", () => {
		const tab = makeTab("/vault/papers/x", {
			kind: "paper",
			title: "Attention Is All You Need",
		});
		expect(panelPersistParams(tab)).toEqual({
			panelId: "/vault/papers/x",
			path: "/vault/papers/x",
			mode: "markdown",
			title: "Attention Is All You Need",
		});
	});
});

describe("tab session persistence", () => {
	beforeEach(() => {
		const store = new Map<string, string>();
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: {
				getItem: (k: string) => store.get(k) ?? null,
				setItem: (k: string, v: string) => store.set(k, v),
				removeItem: (k: string) => store.delete(k),
			},
		});
	});

	it("round-trips layout-only storage", () => {
		const layout = {
			grid: {
				root: {
					type: "leaf",
					data: {
						id: "g1",
						views: ["/vault/a.md", "/vault/b.md"],
						activeView: "/vault/b.md",
					},
				},
				height: 1,
				width: 1,
				orientation: "HORIZONTAL",
			},
			panels: {
				"/vault/a.md": {
					id: "/vault/a.md",
					params: {
						panelId: "/vault/a.md",
						path: "/vault/a.md",
						mode: "markdown",
					},
				},
				"/vault/b.md": {
					id: "/vault/b.md",
					params: { panelId: "/vault/b.md", path: "/vault/b.md", mode: "pdf" },
				},
			},
			activeGroup: "g1",
		};
		savePersistedTabs(layout);
		const loaded = loadPersistedTabs();
		expect(loaded?.layout).toEqual(layout);
		expect(loaded?.tabs).toEqual([
			{ id: "/vault/a.md", path: "/vault/a.md", mode: "markdown" },
			{ id: "/vault/b.md", path: "/vault/b.md", mode: "pdf" },
		]);
		expect(loaded?.activeId).toBe("/vault/b.md");
	});

	it("still loads legacy tabs[] + activeIndex without layout", () => {
		localStorage.setItem(
			"agentero-open-tabs",
			JSON.stringify({
				tabs: [
					{ path: "/vault/a.md", mode: "markdown" },
					{ path: "/vault/b.md", mode: "pdf" },
				],
				activeIndex: 1,
			}),
		);
		const loaded = loadPersistedTabs();
		expect(loaded?.tabs).toEqual([
			{ path: "/vault/a.md", mode: "markdown" },
			{ path: "/vault/b.md", mode: "pdf" },
		]);
		expect(loaded?.activeId).toBe("/vault/b.md");
		expect(loaded?.layout).toBeNull();
	});

	it("clears storage when layout is empty", () => {
		savePersistedTabs({
			panels: {
				"/vault/a.md": {
					id: "/vault/a.md",
					params: {
						panelId: "/vault/a.md",
						path: "/vault/a.md",
						mode: "markdown",
					},
				},
			},
		});
		savePersistedTabs(null);
		expect(loadPersistedTabs()).toBeNull();
		savePersistedTabs({ panels: {} });
		expect(loadPersistedTabs()).toBeNull();
	});
});

describe("flat workspace helpers", () => {
	it("createNotesSplitPane reuses notesSeed", () => {
		const tab = makeTab("/vault/p", {
			kind: "paper",
			mode: "pdf",
			notesPath: "/vault/p/NOTES.md",
			notesSeed: "# hi",
			paperMeta: { path: "p", title: "P" } as DocTab["paperMeta"],
		});
		const pane = createNotesSplitPane(tab);
		expect(pane?.notesSeed).toBe("# hi");
		expect(pane?.path).toBe("/vault/p/NOTES.md");
		expect(pane?.title).toBe("Notes");
	});

	it("createNotesSplitPane works even when catalog metadata is missing", () => {
		const tab = makeTab("/vault/p", {
			kind: "paper",
			mode: "pdf",
			notesPath: "/vault/p/NOTES.md",
			notesSeed: "# hi",
			paperMeta: null,
		});
		const pane = createNotesSplitPane(tab);
		expect(pane).not.toBeNull();
		expect(pane?.paperMeta).toBeNull();
		expect(pane?.path).toBe("/vault/p/NOTES.md");
		expect(pane?.notesSeed).toBe("# hi");
	});

	it("tabIsPaperNotes recognizes a paper root or NOTES.md without catalog metadata", () => {
		const notesTab = makeTab("/vault/p/NOTES.md", {
			mode: "markdown",
			notesPath: "/vault/p/NOTES.md",
			paperMeta: null,
		});
		expect(tabIsPaperNotes(notesTab)).toBe(true);

		const rootTab = makeTab("/vault/p", {
			mode: "markdown",
			notesPath: "/vault/p/NOTES.md",
			paperMeta: null,
		});
		expect(tabIsPaperNotes(rootTab)).toBe(true);
	});

	it("tabNotesEligible accepts a paper body that has notesPath even without catalog metadata", () => {
		const pdfBody = makeTab("/vault/p", {
			kind: "paper",
			mode: "pdf",
			notesPath: "/vault/p/NOTES.md",
			paperMeta: null,
		});
		expect(tabNotesEligible(pdfBody)).toBe(true);

		const plainPdf = makeTab("/vault/plain.pdf", {
			mode: "pdf",
			notesPath: null,
			paperMeta: null,
		});
		expect(tabNotesEligible(plainPdf)).toBe(false);
	});

	it("tabHasNotesSplit finds NOTES among open panels", () => {
		const paper = makeTab("/vault/p", {
			kind: "paper",
			mode: "pdf",
			notesPath: "/vault/p/NOTES.md",
			paperMeta: { path: "p", title: "P" } as DocTab["paperMeta"],
		});
		const notes = createNotesSplitPane(paper);
		expect(notes).not.toBeNull();
		if (!notes) return;
		expect(tabHasNotesSplit([paper], paper)).toBe(false);
		expect(tabHasNotesSplit([paper, notes], paper)).toBe(true);
	});

	it("paperReadingPlacements stacks NOTES into existing notes column only", () => {
		const paperA = makeTab("/vault/a", {
			kind: "paper",
			mode: "pdf",
			notesPath: "/vault/a/NOTES.md",
			paperMeta: { path: "a", title: "A" } as DocTab["paperMeta"],
		});
		const notesA = createNotesSplitPane(paperA);
		expect(notesA).not.toBeNull();
		if (!notesA) return;

		const place = paperReadingPlacements([paperA, notesA], {
			paperId: "paper-b",
			notesId: "notes-b",
		});
		// Paper body is free (active group / default) — not forced into paper column.
		expect(place.paper).toBeNull();
		expect(place.notes).toEqual({
			direction: "within",
			referencePanelId: notesA.id,
		});
	});

	it("paperReadingPlacements first paper uses right split for NOTES", () => {
		const place = paperReadingPlacements([], {
			paperId: "paper-a",
			notesId: "notes-a",
		});
		expect(place.paper).toBeNull();
		expect(place.notes).toEqual({
			direction: "right",
			referencePanelId: "paper-a",
		});
	});

	it("readingPairCloseIds pairs body→NOTES but not NOTES→body", () => {
		const paper = makeTab("/vault/p", {
			kind: "paper",
			mode: "pdf",
			notesPath: "/vault/p/NOTES.md",
			paperMeta: { path: "p", title: "P" } as DocTab["paperMeta"],
		});
		const notes = createNotesSplitPane(paper);
		expect(notes).not.toBeNull();
		if (!notes) return;
		const open = [paper, notes];
		expect(readingPairCloseIds(open, paper.id).sort()).toEqual(
			[paper.id, notes.id].sort(),
		);
		expect(readingPairCloseIds(open, notes.id)).toEqual([notes.id]);
		expect(readingPairCloseIds([paper], paper.id)).toEqual([paper.id]);
		expect(readingPairCloseIds([notes], notes.id)).toEqual([notes.id]);
	});

	it("closeTab never closes the resident Library tab", () => {
		const library = makeTab(LIBRARY_VIRTUAL_PATH);
		const paper = makeTab("/vault/p", {
			kind: "paper",
			mode: "pdf",
			notesPath: "/vault/p/NOTES.md",
			paperMeta: { path: "p", title: "P" } as DocTab["paperMeta"],
		});
		setTabs([library, paper]);
		closeTab(library.id);
		expect(getTabs().map((t) => t.id)).toEqual([
			LIBRARY_VIRTUAL_PATH,
			paper.id,
		]);
		closeTab(paper.id);
		expect(getTabs().map((t) => t.id)).toEqual([LIBRARY_VIRTUAL_PATH]);
	});

	it("syncUpdatedPaperTabs updates paper tab title and metadata while preserving notes title", () => {
		const vault = "/vault";
		const paperTab = makeTab("/vault/papers/test-paper", {
			kind: "paper",
			title: "Old Paper Title",
			mode: "pdf",
			notesPath: "/vault/papers/test-paper/NOTES.md",
			paperMeta: {
				id: "paper-1",
				path: "papers/test-paper",
				title: "Old Paper Title",
			} as DocTab["paperMeta"],
		});
		const notesTab = makeTab("/vault/papers/test-paper/NOTES.md", {
			kind: "file",
			title: "Notes",
			mode: "markdown",
			notesPath: "/vault/papers/test-paper/NOTES.md",
			paperMeta: {
				id: "paper-1",
				path: "papers/test-paper",
				title: "Old Paper Title",
			} as DocTab["paperMeta"],
		});
		const otherTab = makeTab("/vault/notes/todo.md", {
			kind: "file",
			title: "todo.md",
			mode: "markdown",
		});

		setTabs([paperTab, notesTab, otherTab]);

		syncUpdatedPaperTabs(
			vault,
			"papers/test-paper",
			{
				title: "Brand New Paper Title",
				year: 2026,
			},
			"paper-1",
		);

		const updated = getTabs();
		const updatedPaper = updated.find((t) => t.id === paperTab.id);
		const updatedNotes = updated.find((t) => t.id === notesTab.id);
		const updatedOther = updated.find((t) => t.id === otherTab.id);

		expect(updatedPaper?.title).toBe("Brand New Paper Title");
		expect(updatedPaper?.paperMeta?.title).toBe("Brand New Paper Title");
		expect(updatedPaper?.paperMeta?.year).toBe(2026);

		expect(updatedNotes?.title).toBe("Notes");
		expect(updatedNotes?.paperMeta?.title).toBe("Brand New Paper Title");
		expect(updatedNotes?.paperMeta?.year).toBe(2026);

		expect(updatedOther?.title).toBe("todo.md");
	});
});

describe("Notes layout actions", () => {
	it("opens translation once for a PDF file and keeps it visible when the source gains focus", async () => {
		const previous = getTabs();
		const paper = makeTab("/vault/papers/translate/paper.pdf", {
			mode: "pdf",
			notesPath: "/vault/papers/translate/NOTES.md",
			loaded: true,
		});
		const notes = createNotesSplitPane(paper);
		if (!notes) throw new Error("Missing notes");
		const translationId = `${paper.id}::translation`;
		const handle = {
			openPanel: vi.fn(),
			activatePanel: vi.fn(),
			isPanelVisible: (id: string) => id === translationId,
		};
		registerDockHandle(handle as unknown as DockHandle);
		try {
			setTabs([paper, notes]);
			openTranslationTab(paper.id, "/vault/papers/translate");
			expect(getActiveTabId()).toBe(translationId);
			expect(handle.activatePanel).toHaveBeenLastCalledWith(translationId);
			openTranslationTab(paper.id, "/vault/papers/translate");
			expect(handle.openPanel).toHaveBeenCalledTimes(1);
			await Promise.resolve();
			handle.activatePanel.mockClear();
			handleActivePanelChange(paper.id);
			expect(handle.activatePanel).not.toHaveBeenCalledWith(notes.id);
			openTab(paper.path);
			expect(handle.activatePanel).not.toHaveBeenCalledWith(notes.id);
		} finally {
			registerDockHandle(null);
			setTabs(previous);
		}
	});
	it.each([
		"open",
		"reopen",
		"restore",
	])("pairs notes when a paper PDF is opened as a file (%s)", async (entry) => {
		const path = "/vault/papers/a/a.pdf";
		const notesPath = "/vault/papers/a/NOTES.md";
		const previousVault = vaultStore.getState();
		const previousTabs = getTabs();
		const tab = makeTab(path, {
			kind: "file",
			mode: "pdf",
			notesPath,
			loaded: entry === "reopen",
		});
		vi.spyOn(tauri, "isTauri").mockReturnValue(true);
		vi.spyOn(tabResources, "loadTabResources").mockResolvedValue(
			makeResources({ kind: "file", notesPath }),
		);
		const handle = {
			openPanel: vi.fn(),
			activatePanel: vi.fn(),
			canActivatePanel: vi.fn(() => false),
		};
		registerDockHandle(handle as unknown as DockHandle);
		try {
			vaultStore.setState({
				vaultPath: "/vault",
				tree: [],
				paperFolders: ["/vault/papers/a"],
				treeLoading: false,
			});
			setTabs(entry === "open" ? [] : [tab]);
			if (entry === "restore") hydratePlaceholderTabs([tab.id]);
			else openTab(path);
			await vi.waitFor(() =>
				expect(getTabs().some((tab) => tab.path === notesPath)).toBe(true),
			);
			expect(handle.openPanel).toHaveBeenCalledWith(
				expect.objectContaining({ path: notesPath }),
				{ direction: "right", referencePanelId: tab.id },
			);
		} finally {
			registerDockHandle(null);
			vi.restoreAllMocks();
			vaultStore.setState(previousVault);
			setTabs(previousTabs);
		}
	});
	it("preserves an existing split and remembers/restores it across close and reopen", () => {
		const paper = makeTab("/vault/p", {
			kind: "paper",
			mode: "pdf",
			notesPath: "/vault/p/NOTES.md",
		});
		const notes = createNotesSplitPane(paper);
		if (!notes) throw new Error("Missing notes fixture");
		const handle = {
			openPanel: vi.fn(),
			rememberNotesSplitWidth: vi.fn(),
			restoreNotesSplitWidth: vi.fn(),
		};
		registerDockHandle(handle as unknown as DockHandle);
		try {
			setTabs([paper, notes]);
			setActiveTabId(paper.id);
			setNotesSplit(true, { preserveLayoutMode: true });
			expect(handle.openPanel).not.toHaveBeenCalled();
			expect(handle.restoreNotesSplitWidth).not.toHaveBeenCalled();
			setNotesSplit(false, { preserveLayoutMode: true });
			expect(handle.rememberNotesSplitWidth).toHaveBeenCalledWith(
				paper.id,
				notes.id,
			);
			setActiveTabId(paper.id);
			setNotesSplit(true, { preserveLayoutMode: true });
			expect(handle.openPanel).toHaveBeenCalled();
			expect(handle.restoreNotesSplitWidth).toHaveBeenCalledWith(
				paper.id,
				notes.id,
			);
		} finally {
			registerDockHandle(null);
		}
	});
});
