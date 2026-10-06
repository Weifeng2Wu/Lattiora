import { Check, LoaderCircle } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/core/utils";
import type { AppSettings } from "@/lib/settings";
import {
	applyUiTheme,
	DEFAULT_UI_THEME,
	loadUiThemes,
	UI_THEMES,
	type UiThemeDef,
} from "@/lib/ui/theme";

export function ThemeStep({
	settings,
	patch,
}: {
	settings: AppSettings;
	patch: (p: Partial<AppSettings>) => void;
}) {
	const { t } = useTranslation(["onboarding", "settings"]);
	const { resolvedTheme } = useTheme();
	const [themeDefs, setThemeDefs] = useState<UiThemeDef[]>([]);

	useEffect(() => {
		let active = true;
		void loadUiThemes()
			.then((themes) => {
				if (active) setThemeDefs(themes);
			})
			.catch(() => {
				// Manifest names remain usable if preview data fails to load.
			});
		return () => {
			active = false;
		};
	}, []);

	const isDark = resolvedTheme === "dark";
	const defaultPreview = {
		background: isDark ? "oklch(0.145 0 0)" : "oklch(1 0 0)",
		card: isDark ? "oklch(0.205 0 0)" : "oklch(1 0 0)",
		primary: isDark ? "oklch(0.922 0 0)" : "oklch(0.205 0 0)",
		secondary: isDark ? "oklch(0.269 0 0)" : "oklch(0.97 0 0)",
		accent: isDark ? "oklch(0.269 0 0)" : "oklch(0.97 0 0)",
		foreground: isDark ? "oklch(0.985 0 0)" : "oklch(0.145 0 0)",
		border: isDark ? "oklch(1 0 0 / 10%)" : "oklch(0.922 0 0)",
	};
	const previewThemes = [
		{
			name: DEFAULT_UI_THEME,
			title: t("settings:appearance.uiTheme.default"),
			light: defaultPreview,
			dark: defaultPreview,
		},
		...UI_THEMES.map(
			(meta) =>
				themeDefs.find((theme) => theme.name === meta.name) ?? {
					...meta,
					light: defaultPreview,
					dark: defaultPreview,
				},
		),
	];

	return (
		<div className="space-y-4">
			<div className="grid grid-cols-4 gap-2">
				{previewThemes.map((item) => {
					const colors = isDark ? item.dark : item.light;
					const selected = item.name === settings.uiTheme;
					return (
						<button
							key={item.name}
							type="button"
							aria-label={t("theme.uiThemeSelect", { name: item.title })}
							aria-pressed={selected}
							onClick={() => {
								patch({ uiTheme: item.name });
								void applyUiTheme(item.name);
							}}
							className={cn(
								"group relative h-12 min-w-0 rounded-lg border p-1 text-left outline-none transition-colors hover:border-primary/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
								selected ? "border-primary/70" : "border-border/70",
							)}
						>
							<div
								className="h-full overflow-hidden rounded-md border border-black/10 p-1 dark:border-white/10"
								style={{ backgroundColor: colors.background }}
							>
								<div className="mb-0.5 flex items-center gap-1">
									<span
										className="h-1 w-1/3 rounded-full"
										style={{ backgroundColor: colors.primary }}
									/>
									<span
										className="h-1 flex-1 rounded-full opacity-60"
										style={{ backgroundColor: colors.foreground }}
									/>
								</div>
								<div
									className="rounded border p-0.5"
									style={{
										backgroundColor: colors.card,
										borderColor: colors.border,
									}}
								>
									<div className="flex gap-1">
										<span
											className="h-1.5 flex-1 rounded-sm"
											style={{ backgroundColor: colors.secondary }}
										/>
										<span
											className="h-1.5 w-1/3 rounded-sm"
											style={{ backgroundColor: colors.accent }}
										/>
									</div>
								</div>
							</div>
							{selected ? (
								<Check className="absolute top-1 right-1 size-3 text-primary" />
							) : null}
						</button>
					);
				})}
			</div>
			{themeDefs.length === 0 ? (
				<LoaderCircle className="mx-auto size-3.5 animate-spin text-muted-foreground" />
			) : null}
		</div>
	);
}
