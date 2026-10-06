export {
	basenameOf,
	createPlaceholderTab,
	ensureFullLibraryTab,
	insertPlaceholderTab,
	normalizeTabPath,
	patchFromTabResources,
	patchTab,
	remapPathUnder,
	remapTabsUnderPath,
	removeTab,
	removeTabsUnderPath,
	SPLIT_PANE_ID_MARKER,
	splitPaneIdForPath,
	tabIdForPath,
} from "@/lib/workspace/tabs/model";
export {
	createNotesSplitPane,
	isPaperContentTab,
	paperReadingPlacements,
	readingPairCloseIds,
	refreshExcalidrawTab,
	refreshPdfTab,
	refreshTextTab,
	reseedExcalidrawTab,
	reseedMarkdownTab,
	reseedNotesTab,
	reseedTextTab,
	syncTabSeedsForPath,
	tabHasNotesSplit,
	tabIsPaperNotes,
	tabNotesEligible,
} from "@/lib/workspace/tabs/notes-split";
export {
	extractTabsFromLayout,
	loadPersistedTabs,
	panelPersistParams,
	savePersistedTabs,
} from "@/lib/workspace/tabs/persist";
export {
	loadTabResources,
	revokeTabMediaSources,
} from "@/lib/workspace/tabs/resources";
export {
	createTranslationSplitPane,
	translationSplitPlacement,
} from "@/lib/workspace/tabs/translation-split";
export type {
	DocTab,
	OpenPlacement,
	SplitDirection,
	TabResources,
} from "@/lib/workspace/tabs/types";
