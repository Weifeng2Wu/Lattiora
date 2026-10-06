import { ThemeProvider } from "next-themes";
import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { CloudGate } from "@/components/cloud/cloud-gate";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { errorText } from "@/lib/core/error";
import { initLogger, logger } from "@/lib/core/logger";
import { initAutoHideScrollbars } from "@/lib/core/scrollbars";
import {
	applyDocumentChrome,
	ensureSettingsLoaded,
	initSettingsSync,
	loadSettings,
	subscribeSettings,
} from "@/lib/settings";
import { initSettingsStore } from "@/lib/settings/react-store";
import { initShellLayoutFromPrefs } from "@/lib/shell/ui-store";
import { applyUiTheme } from "@/lib/ui/theme";
import { initVaultStore } from "@/lib/vault/store";
import { initWorkspaceStore } from "@/lib/workspace/store";
import i18n, { applyLocale } from "./i18n";
import "./index.css";

// Set before the lazy Excalidraw module registers its FontFace URLs.
// These assets are bundled locally and included in the offline shell.
(window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH =
	"/excalidraw/";

// `performance.now()` is measured from navigation start, so these numbers cover
// index.html + main.tsx module loading too, not just the boot chain. `boot` is a
// serial await chain and in dev every step is a module request, so a slow window
// needs per-stage numbers to be actionable rather than guesswork.
const bootElapsed = () => Math.round(performance.now());
function bootStage(name: string) {
	logger.info(`boot stage=${name} ms=${bootElapsed()}`);
}

async function boot() {
	// Public recipients must never initialize or hydrate the private workspace.
	if (location.pathname.startsWith("/share/")) {
		applyLocale("system");
		const { PublicSharePage } = await import(
			"@/components/cloud/public-share-page"
		);
		ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
			<I18nextProvider i18n={i18n}>
				<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
					<PublicSharePage id={location.pathname.slice("/share/".length)} />
					<Toaster />
				</ThemeProvider>
			</I18nextProvider>,
		);
		return;
	}
	void initLogger();
	logger.info("op start frontend_boot");
	bootStage("entry");

	// Host XDG settings.json (migrates legacy localStorage once).
	await ensureSettingsLoaded();
	bootStage("settings");
	initSettingsSync();
	const initialSettings = loadSettings();
	// Native caption (Windows / Linux) follows the stored preference from the
	// first frame; the subscription below keeps later changes in sync.
	// Apply scale + interface/mono fonts before first paint so settings/main
	// windows do not flash the stylesheet default then switch.
	applyDocumentChrome({
		uiScale: initialSettings.uiScale,
		interfaceFontFamily: initialSettings.interfaceFontFamily,
		monoFontFamily: initialSettings.monoFontFamily,
	});
	await applyUiTheme(initialSettings.uiTheme).catch((e) => {
		console.warn("[theme] failed to apply initial UI theme", e);
	});
	bootStage("theme");
	subscribeSettings((s) => {
		void applyUiTheme(s.uiTheme);
		applyDocumentChrome({
			uiScale: s.uiScale,
			interfaceFontFamily: s.interfaceFontFamily,
			monoFontFamily: s.monoFontFamily,
		});
		// Keep every window (settings / feature / doc / main) in sync when
		// locale changes elsewhere. SettingsNativeRoot also applies locally
		// for an immediate switch before the Host round-trip.
		applyLocale(s.locale);
	});
	initAutoHideScrollbars();
	applyLocale(initialSettings.locale);
	bootStage("i18n");

	const root = document.getElementById("root") as HTMLElement;
	const { SelectionChatPopover } = await import(
		"@/components/selection/selection-chat-popover"
	);
	// Lazy-load the full app so the settings window (which returns above) never
	// downloads/parses the heavyweight workspace bundle. The PDF engine host and
	// KaTeX styles ride along here for the same reason: the settings webview has
	// no viewer and no math, so it must not pay for PDFium or the KaTeX fonts.
	// Keep the engine host outside StrictMode below so dev effect replay cannot
	// initialize a second PDFium instance.
	const [{ default: App }, { PdfEngineHost }, { EditorDndProvider }] =
		await Promise.all([
			new URLSearchParams(location.search).get("view") === "mobile" ||
			(new URLSearchParams(location.search).get("view") !== "desktop" &&
				matchMedia("(max-width: 767px)").matches)
				? import("./components/mobile/mobile-app")
				: import("./App"),
			import("@/components/viewer/pdf/engine-provider"),
			import("@/components/editor/plugins/dnd-kit"),
			import("katex/dist/katex.min.css"),
		]);
	bootStage("app-module");
	initSettingsStore();
	initVaultStore();
	initWorkspaceStore();
	initShellLayoutFromPrefs();
	ReactDOM.createRoot(root).render(
		<PdfEngineHost>
			{/* HTML5Backend cannot remount under StrictMode — drag sources go dead. */}
			<EditorDndProvider>
				<React.StrictMode>
					<I18nextProvider i18n={i18n}>
						<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
							<TooltipProvider delayDuration={300}>
								<CloudGate>
									<App />
								</CloudGate>
								<SelectionChatPopover />
								{/* Global error / notice stack (top-right); use notifyError from @/lib/notify */}
								<Toaster />
							</TooltipProvider>
						</ThemeProvider>
					</I18nextProvider>
				</React.StrictMode>
			</EditorDndProvider>
		</PdfEngineHost>,
	);
	logger.info(
		`op end frontend_boot ok=true duration_ms=${bootElapsed()} window=main`,
	);
}

if (
	import.meta.env.PROD &&
	!location.pathname.startsWith("/share/") &&
	"serviceWorker" in navigator
) {
	void navigator.serviceWorker
		.register("/sw.js")
		.catch((error) =>
			console.error("Offline shell registration failed", error),
		);
}

void boot().catch((e) => {
	// A failed boot used to leave an empty <body> with no key handlers, so the
	// window (especially the separate Settings webview) looked blank and could
	// not be dismissed from the keyboard. Surface the error and wire Esc/⌘W so
	// the window is always closable.
	console.error("[boot] failed", e);
	const root = document.getElementById("root");
	if (root) {
		root.textContent = `Failed to start: ${errorText(e)}`;
		root.setAttribute(
			"style",
			"padding:24px;font:13px system-ui;white-space:pre-wrap;",
		);
	}
});
