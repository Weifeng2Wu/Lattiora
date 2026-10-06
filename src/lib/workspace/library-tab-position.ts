import type { DockviewApi, IDockviewPanel } from "dockview";
import { isLibraryVirtualPath } from "@/lib/paper/api";

export function isLibraryPanel(panel: IDockviewPanel | undefined): boolean {
	return isLibraryVirtualPath(panel?.params?.path);
}

/** Also repairs old layouts and programmatic insertions without stealing focus. */
export function ensureLibraryTabFirst(api: DockviewApi): void {
	for (const group of api.groups) {
		const library = group.panels.find(isLibraryPanel);
		if (!library || group.panels[0] === library) continue;
		library.api.moveTo({ index: 0, skipSetActive: true });
	}
}
