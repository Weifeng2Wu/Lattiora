/**
 * Native singleton feature windows (Agent / Annotations).
 *
 * Policy: at most one surface per view. If a feature window is open, all open
 * intents focus that window and the main right-rail must not host
 * a second instance of the same view.
 *
 * Note: do not statically import `@/lib/shell/ui-store` — that store module is
 * read here; the opening actions that import this file live in
 * `ui-window-actions` (ui-window-actions → feature-window → ui-store).
 */

import i18n from "@/i18n";
import { notifyError } from "@/lib/core/notify";
import type { FeatureViewType } from "@/lib/shell/ui-store";

export type { FeatureViewType };

/** Same set as right-rail tabs / leaf feature views. */
const FEATURE_TAB_ORDER: FeatureViewType[] = ["agent", "annotations"];

export function featureWindowLabel(view: FeatureViewType): string {
	return `feature-${view}`;
}

/** Open or focus the singleton feature window for `view`. */
export async function openFeatureWindow(_view: FeatureViewType): Promise<void> {
	notifyError(i18n.t("app:windows.featureDesktopOnly"));
	return;
}

/**
 * Probe whether the singleton feature Webview exists and focus it.
 * Only clears `featurePoppedOut` when the label is confirmed missing — not on
 * transient focus/API errors (avoids opening a second rail instance).
 */
export async function focusFeatureWindow(
	_view: FeatureViewType,
): Promise<boolean> {
	return false;
}

/**
 * Prefer an existing singleton feature window over the main right rail.
 * Returns true when the window was found and focused.
 */
export async function preferFeatureWindow(
	view: FeatureViewType,
): Promise<boolean> {
	return focusFeatureWindow(view);
}

export function isFeatureViewType(
	value: string | null | undefined,
): value is FeatureViewType {
	return FEATURE_TAB_ORDER.includes(value as FeatureViewType);
}

export function readFeatureWindowView(): FeatureViewType | null {
	try {
		const view = new URLSearchParams(window.location.search).get("view");
		return isFeatureViewType(view) ? view : null;
	} catch {
		return null;
	}
}
