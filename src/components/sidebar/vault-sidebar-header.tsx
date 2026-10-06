/**
 * Vault title bar: switch vault dropdown + magic-wand import popover.
 * Stateless relative to FileTree (no shared internal state).
 */

import {
	FileUp,
	FolderInput,
	Loader2,
	Trash2,
	Upload,
	WandSparkles,
	X,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SkillUploadButton } from "@/components/dialogs/skill-upload-button";
import { PaneHeader } from "@/components/shell/pane-header";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useImeGuard } from "@/hooks/use-ime-guard";
import { errorText } from "@/lib/core/error";
import { formatShortcutById } from "@/lib/shell/shortcuts";
export type VaultSidebarHeaderProps = {
	title: string;
	/** Transient tree multi-selection mode; replaces, never stacks on, this header. */
	selection?: {
		count: number;
		disabled?: boolean;
		onClear: () => void;
		onMove?: (anchor: { x: number; y: number }) => void;
		onDelete: () => void;
	};
	/** Vault-relative papers parent, e.g. `papers` or `papers/nlp` */
	lookupParentDir: string;
	onLookupSubmit: (texts: string[]) => Promise<void>;
	/** Bibliography import (bottom-left of magic-wand popover). */
	onImportBibliography?: () => void | Promise<void>;
	/** Local PDF import (bottom-left of magic-wand popover). */
	onImportLocalPdf?: () => void | Promise<void>;
	importBusy?: boolean;
	importPdfBusy?: boolean;
	busy?: boolean;
	isDemo: boolean;
	/**
	 * Increment from App (e.g. ⇧⌘I) to open the magic-wand popover.
	 * Only reacts to positive values after mount.
	 */
	lookupOpenSignal?: number;
	recentVaults: string[];
	vaultPath: string | null;
	onOpenRecent: (path: string) => void;
	onRemoveRecent: (path: string) => void;
	onOpenVault: () => void;
	onCreateVault: () => void;
};

export const VaultSidebarHeader = memo(function VaultSidebarHeader({
	selection,
	lookupParentDir,
	onLookupSubmit,
	onImportBibliography,
	onImportLocalPdf,
	importBusy,
	importPdfBusy,
	busy,
	isDemo,
	lookupOpenSignal = 0,
}: VaultSidebarHeaderProps) {
	const { t } = useTranslation(["sidebar", "shortcuts", "app", "common"]);
	const [wandOpen, setWandOpen] = useState(false);
	const [lookupText, setLookupText] = useState("");
	const [lookupBusy, setLookupBusy] = useState(false);
	const [lookupError, setLookupError] = useState<string | null>(null);
	const lookupTextareaRef = useRef<HTMLTextAreaElement>(null);
	// IME: compositionend can fire before the confirming Enter (see useImeGuard).
	const { isBlockedByIme, compositionProps } = useImeGuard();

	const actionsDisabled =
		busy || isDemo || Boolean(importBusy) || Boolean(importPdfBusy);
	const lookupDisabled = busy || isDemo;
	const magicWandShortcut = formatShortcutById("magicWand");
	const selectionActive = Boolean(selection && selection.count > 0);

	useEffect(() => {
		if (selectionActive) setWandOpen(false);
	}, [selectionActive]);

	useEffect(() => {
		if (lookupOpenSignal <= 0 || isDemo || busy) return;
		setWandOpen(true);
		setLookupError(null);
	}, [lookupOpenSignal, isDemo, busy]);

	/**
	 * Split on line/list separators only — spaces belong to titles and to
	 * `npx skills add …`. The Host expands space-separated identifier lists.
	 */
	const parseLookupTexts = (text: string): string[] =>
		text
			.split(/[\n\r,;，；]+/)
			.map((t) => t.trim())
			.filter(Boolean);

	const runLookup = async () => {
		const texts = parseLookupTexts(lookupText);
		if (texts.length === 0 || lookupBusy) return;
		setLookupBusy(true);
		setLookupError(null);
		try {
			await onLookupSubmit(texts);
			setLookupText("");
			setWandOpen(false);
		} catch (e) {
			setLookupError(errorText(e));
		} finally {
			setLookupBusy(false);
		}
	};

	if (selection && selection.count > 0) {
		return (
			<TooltipProvider delayDuration={300}>
				<div className="shrink-0">
					<PaneHeader
						className="relative z-10 border-b-0"
						trailing={
							<>
								{selection.onMove ? (
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon-xs"
												disabled={selection.disabled}
												aria-label={t("sidebar:fileTree.moveSelected", {
													count: selection.count,
												})}
												onClick={(event) => {
													const rect =
														event.currentTarget.getBoundingClientRect();
													selection.onMove?.({ x: rect.left, y: rect.top });
												}}
											>
												<FolderInput className="size-3.5" />
											</Button>
										</TooltipTrigger>
										<TooltipContent side="bottom">
											{t("sidebar:fileTree.moveSelected", {
												count: selection.count,
											})}
										</TooltipContent>
									</Tooltip>
								) : null}
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											className="text-destructive"
											disabled={selection.disabled}
											aria-label={t("sidebar:fileTree.deleteSelected", {
												count: selection.count,
											})}
											onClick={selection.onDelete}
										>
											<Trash2 className="size-3.5" />
										</Button>
									</TooltipTrigger>
									<TooltipContent side="bottom">
										{t("sidebar:fileTree.deleteSelected", {
											count: selection.count,
										})}
									</TooltipContent>
								</Tooltip>
							</>
						}
					>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									aria-label={t("sidebar:fileTree.clearSelection")}
									onClick={selection.onClear}
								>
									<X className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">
								{t("sidebar:fileTree.clearSelection")}
							</TooltipContent>
						</Tooltip>
						<span className="min-w-0 truncate font-medium text-sm">
							{t("sidebar:fileTree.selectedCount", {
								count: selection.count,
							})}
						</span>
					</PaneHeader>
				</div>
			</TooltipProvider>
		);
	}

	return (
		<TooltipProvider delayDuration={300}>
			<div className="shrink-0">
				<PaneHeader
					className="relative z-10 border-b-0"
					trailing={
						<Popover
							open={wandOpen}
							onOpenChange={(open) => {
								setWandOpen(open);
								if (!open) setLookupError(null);
							}}
						>
							<Tooltip>
								<TooltipTrigger asChild>
									<PopoverTrigger asChild>
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											data-magic-wand
											aria-label={t("lookup.magicWand")}
											disabled={lookupDisabled}
										>
											<WandSparkles className="size-3.5" />
										</Button>
									</PopoverTrigger>
								</TooltipTrigger>
								<TooltipContent side="bottom">
									{t("lookup.magicWand")}
									<span className="ml-2 text-muted-foreground">
										{magicWandShortcut}
									</span>
								</TooltipContent>
							</Tooltip>
							<PopoverContent
								align="end"
								side="bottom"
								className="w-72 gap-2 p-2.5"
							>
								<form
									className="flex flex-col gap-2"
									onSubmit={(e) => {
										e.preventDefault();
										void runLookup();
									}}
								>
									<p className="text-muted-foreground text-xs">
										{t("lookup.addTo", { path: lookupParentDir })}
									</p>
									<Textarea
										ref={lookupTextareaRef}
										value={lookupText}
										onChange={(e) => {
											setLookupText(e.target.value);
											// Auto-grow up to max-h-32; shrink when lines are removed.
											const el = lookupTextareaRef.current;
											if (el) {
												el.style.height = "auto";
												el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
											}
										}}
										onKeyDown={(e) => {
											if (e.key === "Enter" && !e.shiftKey) {
												// Let the IME confirm its candidate; don't search yet.
												if (isBlockedByIme(e)) return;
												e.preventDefault();
												void runLookup();
											}
										}}
										{...compositionProps}
										placeholder={t("lookup.placeholder")}
										disabled={lookupBusy}
										className="min-h-[2.5rem] max-h-32 resize-none overflow-y-auto text-xs"
										rows={1}
									/>
									{lookupError ? (
										<p className="text-destructive text-xs leading-snug">
											{lookupError}
										</p>
									) : null}
									{/* Imports bottom-left (PDF · bibliography · Zotero) · Add bottom-right */}
									<div className="flex items-center justify-between gap-2">
										<div className="flex items-center gap-1">
											<SkillUploadButton />
											{onImportLocalPdf ? (
												<Tooltip>
													<TooltipTrigger asChild>
														<Button
															type="button"
															variant="ghost"
															size="icon-xs"
															disabled={actionsDisabled || Boolean(importBusy)}
															aria-label={t("papersLibrary.importPdf")}
															onClick={() => {
																void onImportLocalPdf();
															}}
														>
															{importPdfBusy ? (
																<Loader2 className="size-3.5 animate-spin" />
															) : (
																<FileUp className="size-3.5" />
															)}
														</Button>
													</TooltipTrigger>
													<TooltipContent side="bottom">
														{t("papersLibrary.importPdf")}
													</TooltipContent>
												</Tooltip>
											) : null}
											{onImportBibliography ? (
												<Tooltip>
													<TooltipTrigger asChild>
														<Button
															type="button"
															variant="ghost"
															size="icon-xs"
															disabled={actionsDisabled || Boolean(importBusy)}
															aria-label={t("papersLibrary.import")}
															onClick={() => {
																void onImportBibliography();
															}}
														>
															{importBusy ? (
																<Loader2 className="size-3.5 animate-spin" />
															) : (
																<Upload className="size-3.5" />
															)}
														</Button>
													</TooltipTrigger>
													<TooltipContent side="bottom">
														{t("papersLibrary.import")}
													</TooltipContent>
												</Tooltip>
											) : null}
										</div>
										<Button
											type="submit"
											size="sm"
											className="h-7 px-2.5 text-xs"
											disabled={lookupBusy || !lookupText.trim()}
										>
											{lookupBusy ? t("lookup.adding") : t("lookup.add")}
										</Button>
									</div>
								</form>
							</PopoverContent>
						</Popover>
					}
				>
					{
						<span className="truncate px-1 font-medium text-sm">
							{t("common:brand.name")}
						</span>
					}
				</PaneHeader>
			</div>
		</TooltipProvider>
	);
});
