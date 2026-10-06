/**
 * React-facing settings mirror (zustand vanilla). `lib/settings` keeps its
 * redacted module cache and browser sync semantics; this store adds change notifications
 * for local saves so components can subscribe with selectors instead of the
 * old App-level useState copy.
 */

import { createStore } from "zustand/vanilla";
import {
	type AppSettings,
	loadSettings,
	saveSettings,
	subscribeSettings,
} from "@/lib/settings";

export const settingsStore = createStore<AppSettings>(() => loadSettings());

let synced = false;

/** Start mirroring cross-window settings snapshots; call once after boot. */
export function initSettingsStore(): void {
	if (synced) return;
	synced = true;
	settingsStore.setState(loadSettings(), true);
	subscribeSettings((next) => {
		const prev = settingsStore.getState();
		if (JSON.stringify(prev) === JSON.stringify(next)) return;
		settingsStore.setState(next, true);
	});
}

export function getSettings(): AppSettings {
	return settingsStore.getState();
}

/** Persist and broadcast a full settings snapshot. */
function updateSettings(next: AppSettings): void {
	saveSettings(next);
}

export function patchSettings(patch: Partial<AppSettings>): void {
	updateSettings({ ...settingsStore.getState(), ...patch });
}
