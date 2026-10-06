import { ChevronDown, Minus, PanelRight, Plus } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { PDF_CHROME_CHIP } from "@/components/viewer/pdf/chrome/pdf-chrome-surface";
import {
	FONT_SIZES,
	type TextEditorFontSize,
} from "@/components/viewer/text-editor-font-size";
import { cn } from "@/lib/core/utils";

interface TextEditorToolbarProps {
	fontSize: TextEditorFontSize;
	onFontSizeChange: (size: TextEditorFontSize) => void;
	previewOpen?: boolean;
	onTogglePreview?: () => void;
}

export function TextEditorToolbar({
	fontSize,
	onFontSizeChange,
	previewOpen,
	onTogglePreview,
}: TextEditorToolbarProps) {
	const { t } = useTranslation(["settings", "viewer"]);
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);

	const handleSelect = useCallback(
		(size: TextEditorFontSize) => {
			onFontSizeChange(size);
			setOpen(false);
		},
		[onFontSizeChange],
	);

	const increment = useCallback(() => {
		const idx = FONT_SIZES.indexOf(fontSize);
		if (idx < FONT_SIZES.length - 1) {
			onFontSizeChange(FONT_SIZES[idx + 1]);
		}
	}, [fontSize, onFontSizeChange]);

	const decrement = useCallback(() => {
		const idx = FONT_SIZES.indexOf(fontSize);
		if (idx > 0) {
			onFontSizeChange(FONT_SIZES[idx - 1]);
		}
	}, [fontSize, onFontSizeChange]);

	return (
		<div className="pointer-events-none absolute top-2 right-3 z-20 flex origin-top-right items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
			<div
				data-text-editor-chrome
				className={cn(
					"pointer-events-auto flex h-7 select-none items-center gap-0.5 rounded-lg p-0.5",
					PDF_CHROME_CHIP,
				)}
			>
				{onTogglePreview ? (
					<Button
						type="button"
						size="icon-xs"
						variant={previewOpen ? "secondary" : "ghost"}
						aria-label={t("viewer:texPreview.title")}
						title={t("viewer:texPreview.title")}
						aria-pressed={previewOpen}
						onClick={onTogglePreview}
					>
						<PanelRight className="size-3.5" aria-hidden />
					</Button>
				) : null}
				<Button
					type="button"
					size="icon-xs"
					variant="ghost"
					className="shrink-0 self-center"
					aria-label={t("appearance.fontSize.decrease")}
					disabled={fontSize <= FONT_SIZES[0]}
					onClick={decrement}
				>
					<Minus className="size-3.5" aria-hidden />
				</Button>

				<Popover open={open} onOpenChange={setOpen}>
					<PopoverTrigger asChild>
						<Button
							type="button"
							size="xs"
							variant="ghost"
							className="flex h-5 min-w-7 gap-0.5 self-center whitespace-nowrap px-1.5 text-xs"
							ref={triggerRef}
							aria-label={t("appearance.fontSize.select")}
						>
							<span>{fontSize}</span>
							<ChevronDown className="size-3" aria-hidden />
						</Button>
					</PopoverTrigger>
					<PopoverContent
						side="bottom"
						align="end"
						className="w-auto p-1"
						onOpenAutoFocus={(e) => e.preventDefault()}
					>
						<div className="flex flex-col gap-0.5">
							{FONT_SIZES.map((size) => (
								<button
									key={size}
									type="button"
									onClick={() => handleSelect(size)}
									className={cn(
										"flex h-7 w-full items-center justify-center rounded-md px-3 text-xs",
										"hover:bg-accent hover:text-accent-foreground",
										"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
										"transition-colors duration-[var(--motion-duration-micro)]",
										size === fontSize
											? "bg-accent font-medium text-accent-foreground"
											: "text-muted-foreground",
									)}
								>
									{size}px
								</button>
							))}
						</div>
					</PopoverContent>
				</Popover>

				<Button
					type="button"
					size="icon-xs"
					variant="ghost"
					className="shrink-0 self-center"
					aria-label={t("appearance.fontSize.increase")}
					disabled={fontSize >= FONT_SIZES[FONT_SIZES.length - 1]}
					onClick={increment}
				>
					<Plus className="size-3.5" aria-hidden />
				</Button>
			</div>
		</div>
	);
}
