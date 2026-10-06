/**
 * Selector-based hooks over the app's vanilla zustand stores.
 * Always pass a selector so components re-render only for their slice.
 */

import { useStore } from "zustand";
import { selectionStore } from "@/lib/agent/selection-store";
import { visualContextStore } from "@/lib/agent/visual-context-store";
import { libraryStore } from "@/lib/paper/library-store";
import { settingsStore } from "@/lib/settings/react-store";
import { uiStore } from "@/lib/shell/ui-store";
import { vaultStore } from "@/lib/vault/store";
import { wikiStore } from "@/lib/wiki/store";
import { workspaceStore } from "@/lib/workspace/store";

type ExtractState<S> = S extends { getState: () => infer T } ? T : never;

export function useVaultStore<T>(
	selector: (state: ExtractState<typeof vaultStore>) => T,
): T {
	return useStore(vaultStore, selector);
}

export function useWorkspaceStore<T>(
	selector: (state: ExtractState<typeof workspaceStore>) => T,
): T {
	return useStore(workspaceStore, selector);
}

export function useLibraryStore<T>(
	selector: (state: ExtractState<typeof libraryStore>) => T,
): T {
	return useStore(libraryStore, selector);
}

export function useWikiStore<T>(
	selector: (state: ExtractState<typeof wikiStore>) => T,
): T {
	return useStore(wikiStore, selector);
}

export function useUiStore<T>(
	selector: (state: ExtractState<typeof uiStore>) => T,
): T {
	return useStore(uiStore, selector);
}

export function useSelectionStore<T>(
	selector: (state: ExtractState<typeof selectionStore>) => T,
): T {
	return useStore(selectionStore, selector);
}

export function useVisualContextStore<T>(
	selector: (state: ExtractState<typeof visualContextStore>) => T,
): T {
	return useStore(visualContextStore, selector);
}

export function useSettings<T>(
	selector: (state: ExtractState<typeof settingsStore>) => T,
): T {
	return useStore(settingsStore, selector);
}
