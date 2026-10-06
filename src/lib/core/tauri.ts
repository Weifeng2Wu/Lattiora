/** True when running inside a Tauri webview (not plain browser). */
export function isTauri(): boolean {
	return (
		typeof window !== "undefined" &&
		("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
	);
}

/** Browser build with an IndexedDB workspace and a Cloudflare host. */
export function isCloud(): boolean {
	return import.meta.env.VITE_CLOUD === "1";
}

/** File/catalog operations are available in both desktop and cloud builds. */
export function hasWorkspaceRuntime(): boolean {
	return isTauri() || isCloud();
}

/**
 * Best-effort desktop OS detection from the webview UA.
 * Mirrors the platform checks in `shortcuts.ts` / `reveal.ts`.
 */
export function getPlatformOS(): "macos" | "windows" | "linux" | "other" {
	if (typeof navigator === "undefined") return "other";
	const platform = navigator.platform ?? "";
	const ua = navigator.userAgent ?? "";
	if (/Mac|iPhone|iPad|iPod/.test(platform)) return "macos";
	if (/Win/.test(platform) || /Windows/.test(ua)) return "windows";
	if (/Linux|X11/.test(platform)) return "linux";
	return "other";
}

/**
 * macOS keeps native traffic lights via the Overlay title bar; other desktop
 * platforms use a frameless window with custom caption buttons.
 */
export function isMacOS(): boolean {
	return getPlatformOS() === "macos";
}

/** Windows desktop shell (user-PATH registry handling, terminal wording). */
export function isWindows(): boolean {
	return getPlatformOS() === "windows";
}

/** Phone/tablet app shell: iPhone/iPad (incl. iPadOS `MacIntel`) or Android. */
export function isMobileApp(): boolean {
	if (isCloud()) return false;
	if (typeof window === "undefined" || typeof navigator === "undefined") {
		return false;
	}
	if (
		new URLSearchParams(window.location.search).get("mobilePreview") === "1"
	) {
		return true;
	}
	const platform = navigator.platform ?? "";
	const ua = navigator.userAgent ?? "";
	return (
		/iPhone|iPad|iPod/.test(platform) ||
		/iPhone|iPad|iPod|Android/.test(ua) ||
		(platform === "MacIntel" && navigator.maxTouchPoints > 1)
	);
}
