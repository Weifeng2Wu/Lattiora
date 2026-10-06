import { useTheme } from "next-themes";
import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import {
	preloadSettingsPane,
	SettingsContent,
} from "@/components/settings/settings-content";
import type { SettingsSection } from "@/components/settings/types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { refreshSettingsSecrets } from "@/lib/cloud/settings";
import { saveSettings } from "@/lib/settings";
import { settingsStore } from "@/lib/settings/react-store";
import { setSettingsOpenState } from "@/lib/shell/ui-store";

export function CloudAiSettingsDialog() {
	const { t } = useTranslation("settings");
	const [open, setOpen] = useState(false);
	const [section, setSection] = useState<SettingsSection>("general");
	const settings = useStore(settingsStore);
	const { setTheme } = useTheme();
	const titleId = useId();
	const changeOpen = useCallback((value: boolean) => {
		setOpen(value);
		setSettingsOpenState(value);
	}, []);
	useEffect(() => {
		setTheme(settings.theme);
	}, [settings.theme, setTheme]);
	useEffect(() => {
		const show = (event: Event) => {
			const candidate =
				(event as CustomEvent<{ section?: string }>).detail?.section ??
				"general";
			const allowed = [
				"general",
				"appearance",
				"agent",
				"translate",
				"layout",
				"sync",
				"doctor",
				"keyboard",
				"about",
			];
			const next = (
				allowed.includes(candidate) ? candidate : "general"
			) as SettingsSection;
			setSection(next);
			void preloadSettingsPane(next);
			changeOpen(true);
			// Offline preference editing must remain available without a server.
			void refreshSettingsSecrets().catch(() => undefined);
		};
		const close = () => changeOpen(false);
		window.addEventListener("cloud:settings", show);
		window.addEventListener("cloud:settings-close", close);
		return () => {
			window.removeEventListener("cloud:settings", show);
			window.removeEventListener("cloud:settings-close", close);
		};
	}, [changeOpen]);
	return (
		<Dialog open={open} onOpenChange={changeOpen}>
			<DialogContent
				showCloseButton={false}
				aria-describedby={undefined}
				aria-labelledby={titleId}
				className="flex h-[min(90dvh,52rem)] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0 sm:max-w-5xl"
			>
				<DialogTitle className="sr-only">{t("title")}</DialogTitle>
				<SettingsContent
					section={section}
					onSectionChange={setSection}
					settings={settings}
					onChange={saveSettings}
					onClose={() => changeOpen(false)}
					titleId={titleId}
					vaultPath="/cloud"
				/>
			</DialogContent>
		</Dialog>
	);
}
