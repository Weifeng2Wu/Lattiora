import { useTranslation } from "react-i18next";
import {
	PageTitle,
	SettingsGroup,
	SettingsSectionLabel,
	settingsRowClassName,
} from "@/components/settings/settings-layout";
import {
	formatShortcut,
	type ShortcutDef,
	type ShortcutGroup,
	shortcutsByGroup,
} from "@/lib/shell/shortcuts";
import { revealInOsLabelKey } from "@/lib/vault/reveal";

const GROUP_KEY: Record<ShortcutGroup, "app" | "navigation" | "vault"> = {
	App: "app",
	Navigation: "navigation",
	Vault: "vault",
};

export function KeyboardPane() {
	const { t } = useTranslation(["settings", "shortcuts"]);
	const groups = shortcutsByGroup();

	return (
		<>
			<PageTitle title={t("keyboard.title")} />
			{groups.map(({ group, items }) => (
				<div key={group}>
					<SettingsSectionLabel>
						{t(`shortcuts:groups.${GROUP_KEY[group]}`)}
					</SettingsSectionLabel>
					<SettingsGroup>
						{items.map((item) => (
							<ShortcutRow key={item.id} def={item} />
						))}
					</SettingsGroup>
				</div>
			))}
		</>
	);
}

export function ShortcutRow({ def }: { def: ShortcutDef }) {
	const { t } = useTranslation(["shortcuts", "sidebar"]);
	// "Show in Finder" is macOS wording; use the platform-specific file-manager name.
	const label =
		def.id === "revealInFinder"
			? t(`sidebar:${revealInOsLabelKey()}`)
			: t(`labels.${def.id}`);
	return (
		<div className={settingsRowClassName}>
			<span className="text-sm text-foreground">{label}</span>
			<kbd className="rounded-md border border-border/70 bg-muted/70 px-1.5 py-0.5 font-medium font-sans text-xs text-foreground tabular-nums tracking-wide">
				{formatShortcut(def)}
			</kbd>
		</div>
	);
}
