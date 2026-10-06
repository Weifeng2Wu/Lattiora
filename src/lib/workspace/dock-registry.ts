/**
 * Imperative dockview handle registry. The DockWorkspace component registers
 * its handle here so plain action modules (openTab/closeTab/…) can place and
 * activate panels without threading a React ref through every call site.
 * The shape mirrors `DockWorkspaceHandle` structurally (lib must not import
 * components — see .dependency-cruiser.cjs).
 */

import type { DocTab, OpenPlacement } from "@/lib/workspace/tabs";

export type DockHandle = {
	/** Add (or activate) a panel with optional split placement. */
	openPanel: (tab: DocTab, placement?: OpenPlacement) => void;
	/** Add a panel as a right split and rebalance visible grid columns. */
	splitPanelRight: (tab: DocTab, referencePanelId: string | null) => void;
	/** Replace a panel id after a filesystem move while preserving its group. */
	remapPanel: (previousPanelId: string, tab: DocTab) => void;
	/** Cycle active panel by dockview `api.panels` order (wraps). */
	cycleActive: (delta: number) => void;
	/** Activate an existing panel by id. */
	activatePanel: (panelId: string) => void;
	/**
	 * True when `activatePanel` can actually bring the panel to a visible
	 * group (i.e. the panel is registered in this dock, not in a split
	 * pane / popout window this handle cannot see).
	 */
	canActivatePanel: (panelId: string) => boolean;
	/** True when this panel is the visible tab in its dock group. */
	isPanelVisible: (panelId: string) => boolean;
	/** Remember / restore the shared two-column PDF / Notes proportion. */
	rememberNotesSplitWidth: (paperId: string, notesId: string) => void;
	restoreNotesSplitWidth: (paperId: string, notesId: string) => void;
};

let handle: DockHandle | null = null;

export function registerDockHandle(next: DockHandle | null): void {
	handle = next;
}

export function dockHandle(): DockHandle | null {
	return handle;
}
