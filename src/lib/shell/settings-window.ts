/**
 * Native settings window control (single instance; `?window=settings` route).
 */

import { uiStore } from "./ui-store";

export function openSettingsWindow(section: string = "general"): void {
	window.dispatchEvent(
		new CustomEvent("cloud:settings", { detail: { section } }),
	);
	return;
}

export function closeSettingsWindow(): void {
	window.dispatchEvent(new Event("cloud:settings-close"));
	return;
}

export function toggleSettingsWindow(): void {
	if (uiStore.getState().settingsOpen) closeSettingsWindow();
	else openSettingsWindow();
}
