/**
 * Searchable font family picker (Obsidian-style): built-in stacks + system fonts.
 */

import { ChevronsUpDown, LoaderCircle } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/core/utils";
import {
	FONT_STACK_PRESETS,
	type FontRole,
	type FontStackPreset,
	isFontStackPreset,
	listSystemFonts,
	resolveFontFamilyCss,
} from "@/lib/settings";

export type FontFamilyPickerProps = {
	id?: string;
	value: string;
	/** Which CSS role this picker configures (not an ARIA role). */
	fontRole: FontRole;
	onChange: (next: string) => void;
	className?: string;
	/** Narrow trigger for settings rows. */
	size?: "sm" | "default";
};

const PRESET_I18N: Record<
	FontStackPreset,
	| "appearance.fontFamily.default"
	| "appearance.fontFamily.system"
	| "appearance.fontFamily.geist"
	| "appearance.fontFamily.serif"
	| "appearance.fontFamily.mono"
> = {
	default: "appearance.fontFamily.default",
	system: "appearance.fontFamily.system",
	geist: "appearance.fontFamily.geist",
	serif: "appearance.fontFamily.serif",
	mono: "appearance.fontFamily.mono",
};

function previewCss(value: string, role: FontRole): string | undefined {
	const resolved = resolveFontFamilyCss(value || "default", role);
	if (resolved) return resolved;
	if (role === "mono") return resolveFontFamilyCss("mono", "mono");
	return undefined;
}

export function FontFamilyPicker({
	id,
	value,
	fontRole,
	onChange,
	className,
	size = "sm",
}: FontFamilyPickerProps) {
	const { t } = useTranslation("settings");
	const listId = useId();
	const [open, setOpen] = useState(false);
	const [systemFonts, setSystemFonts] = useState<string[]>([]);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setLoading(true);
		void listSystemFonts()
			.then((fonts) => {
				if (!cancelled) setSystemFonts(fonts);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [open]);

	const normalized = value.trim() === "default" ? "" : value.trim();
	const label = (() => {
		if (!normalized) return t("appearance.fontFamily.default");
		if (isFontStackPreset(normalized)) return t(PRESET_I18N[normalized]);
		return normalized;
	})();
	const triggerStyle = useMemo(() => {
		const css = previewCss(normalized, fontRole);
		return css ? { fontFamily: css } : undefined;
	}, [normalized, fontRole]);

	const presets = FONT_STACK_PRESETS;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					id={id}
					type="button"
					variant="outline"
					size={size}
					role="combobox"
					aria-expanded={open}
					aria-controls={listId}
					className={cn(
						"min-w-[160px] max-w-[220px] justify-between font-normal",
						className,
					)}
					style={triggerStyle}
				>
					<span className="truncate">{label}</span>
					<ChevronsUpDown className="ml-1 size-3.5 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="w-[280px] p-0"
				onOpenAutoFocus={(e) => e.preventDefault()}
			>
				<Command id={listId}>
					<CommandInput
						placeholder={t("appearance.fontFamily.search")}
						aria-label={t("appearance.fontFamily.search")}
					/>
					<CommandList className="max-h-[min(50vh,320px)]">
						<CommandEmpty>
							{loading
								? t("appearance.fontFamily.loading")
								: t("appearance.fontFamily.noMatch")}
						</CommandEmpty>
						<CommandGroup heading={t("appearance.fontFamily.suggested")}>
							{presets.map((preset) => {
								const stored = preset === "default" ? "" : preset;
								const selected = normalized === stored;
								const css = previewCss(stored, fontRole);
								const presetLabel = t(PRESET_I18N[preset]);
								return (
									<CommandItem
										key={preset}
										value={`${preset} ${presetLabel}`}
										data-checked={selected || undefined}
										onSelect={() => {
											onChange(stored);
											setOpen(false);
										}}
										style={css ? { fontFamily: css } : undefined}
									>
										<span className="truncate">{presetLabel}</span>
									</CommandItem>
								);
							})}
						</CommandGroup>
						{loading ? (
							<div className="flex items-center justify-center gap-2 py-4 text-muted-foreground text-xs">
								<LoaderCircle className="size-3.5 animate-spin" />
								{t("appearance.fontFamily.loading")}
							</div>
						) : systemFonts.length > 0 ? (
							<CommandGroup heading={t("appearance.fontFamily.systemFonts")}>
								{systemFonts.map((name) => {
									const selected = normalized === name;
									return (
										<CommandItem
											key={name}
											value={name}
											data-checked={selected || undefined}
											onSelect={() => {
												onChange(name);
												setOpen(false);
											}}
											style={{ fontFamily: `"${name.replace(/"/g, '\\"')}"` }}
										>
											<span className="truncate">{name}</span>
										</CommandItem>
									);
								})}
							</CommandGroup>
						) : null}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
