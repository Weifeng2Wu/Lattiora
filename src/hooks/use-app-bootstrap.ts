/**
 * App bootstrap effects: theme / locale / uiScale application, restored-vault
 * validation then `app:ready`, lifecycle handler registration + wire bridge
 * (per-vault side effects run via the `vault:opened` scope), and the JobCenter
 * executor subscriptions. Store seeding happens in `boot()` before first paint.
 */

import { useTheme } from "next-themes";
import { useEffect } from "react";
import { useSettings, useVaultStore } from "@/hooks/use-app-stores";
import { applyLocale } from "@/i18n";
import { startActivityTracking } from "@/lib/activity";
import { startRecognitionQueue } from "@/lib/cloud/recognition";
import { lifecycle } from "@/lib/lifecycle";
import { registerLifecycleHandlers } from "@/lib/lifecycle/register";
import { refreshLibrary } from "@/lib/paper/library-store";
// Side-effect: register catalog title lookup for JobCenter task subjects.
import "@/lib/paper/task-label";
import { applyDocumentChrome } from "@/lib/settings";
import { validateRestoredVault } from "@/lib/vault/actions";
import { setTree, setTreeLoading } from "@/lib/vault/store";

export function useAppBootstrap(): void {
	const { setTheme } = useTheme();
	// CLI / deep-link: agentero open <path> → vault:open-request

	const theme = useSettings((s) => s.theme);
	const locale = useSettings((s) => s.locale);
	const uiScale = useSettings((s) => s.uiScale);
	const interfaceFontFamily = useSettings((s) => s.interfaceFontFamily);
	const monoFontFamily = useSettings((s) => s.monoFontFamily);
	const vaultPath = useVaultStore((s) => s.vaultPath);

	useEffect(() => {
		setTheme(theme);
	}, [theme, setTheme]);

	useEffect(() => {
		applyLocale(locale);
	}, [locale]);

	useEffect(() => {
		// Scale + interface/mono fonts. macOS traffic lights stay build-time only.
		applyDocumentChrome({
			uiScale,
			interfaceFontFamily,
			monoFontFamily,
		});
	}, [uiScale, interfaceFontFamily, monoFontFamily]);

	useEffect(() => startActivityTracking(), []);
	useEffect(() => startRecognitionQueue(), []);

	// Validate the restored local Vault before restoring its tree and tabs, then
	// announce readiness — app:ready must not claim a validation that is still
	// in flight.
	useEffect(() => {
		let cancelled = false;
		void validateRestoredVault().then(() => {
			if (cancelled) return;
			void lifecycle.emit("app:ready", { timestamp: Date.now() });
		});
		return () => {
			cancelled = true;
		};
	}, []);

	// Register lifecycle handlers, then bridge Tauri wire events into the bus.
	useEffect(() => {
		return registerLifecycleHandlers();
	}, []);

	// Per-vault side effects hang off vault:opened (see lifecycle/register.ts).
	// Returning the scope release makes switch / close / unmount all tear down.
	useEffect(() => {
		if (!vaultPath) {
			setTree([]);
			setTreeLoading(false);
			void refreshLibrary();
			return;
		}
		return lifecycle.emitScoped("vault:opened", {
			vaultId: vaultPath,
			timestamp: Date.now(),
		});
	}, [vaultPath]);
}
