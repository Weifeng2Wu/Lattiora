"use client";

import type { DraggableState } from "@platejs/dnd";
import { BlockSelectionPlugin } from "@platejs/selection/react";
import { Copy, CopyPlus, GripVertical, Scissors, Trash2 } from "lucide-react";
import type { TElement } from "platejs";
import { useEditorRef } from "platejs/react";
import {
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";

import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "@/components/ui/popover";
import i18n from "@/i18n";
import { copyTextToClipboard } from "@/lib/core/clipboard";
import { cn } from "@/lib/core/utils";
import {
	duplicateSelectedBlocks,
	removeSelectedBlocks,
	resolveHandleBlocks,
	serializeSelectedBlocksAsMarkdown,
} from "@/lib/markdown/block-selection";
import { formatModShortcut } from "@/lib/shell/shortcuts";

const MENU_CLOSE_MS = 120;
/** Past MENU_CLOSE_MS plus the PopoverContent fade, so the exit animation runs. */
const MENU_UNMOUNT_MS = 400;

type BlockHandleMenuProps = {
	element: TElement;
	handleRef: DraggableState["handleRef"] | undefined;
	isDragging: boolean;
	onMenuOpenChange?: (open: boolean) => void;
	onPrepareDrag: (event: ReactMouseEvent) => void;
	style?: React.CSSProperties;
};

function MenuItem({
	children,
	className,
	destructive,
	onSelect,
	shortcut,
}: {
	children: React.ReactNode;
	className?: string;
	destructive?: boolean;
	onSelect: () => void;
	shortcut?: string;
}) {
	return (
		<button
			type="button"
			className={cn(
				"flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm outline-hidden",
				"hover:bg-accent hover:text-accent-foreground",
				destructive &&
					"text-destructive hover:bg-destructive/10 hover:text-destructive",
				className,
			)}
			onClick={(event) => {
				event.preventDefault();
				onSelect();
			}}
		>
			{children}
			{shortcut ? (
				<span className="ml-auto text-xs tracking-widest text-muted-foreground">
					{shortcut}
				</span>
			) : null}
		</button>
	);
}

/**
 * The action list lives in its own component so the per-block handle does not
 * pay for `useTranslation`, `t()` and `formatModShortcut()` on every render:
 * Radix only mounts `PopoverContent`'s children once the menu is open.
 */
function BlockHandleActions({
	element,
	onDone,
}: {
	element: TElement;
	onDone: () => void;
}) {
	const { t } = useTranslation("editor");
	const editor = useEditorRef();

	const run = useCallback(
		(action: () => void | Promise<void>) => {
			resolveHandleBlocks(editor, element);
			void action();
			onDone();
		},
		[editor, element, onDone],
	);

	return (
		<>
			<MenuItem
				shortcut={formatModShortcut("c")}
				onSelect={() =>
					run(async () => {
						const markdown = serializeSelectedBlocksAsMarkdown(editor);
						if (!markdown) return;
						await copyTextToClipboard(markdown, {
							errorMessage: t("contextMenu.copyFailed"),
						});
					})
				}
			>
				<Copy className="size-4" />
				{t("contextMenu.copy")}
			</MenuItem>
			<MenuItem
				shortcut={formatModShortcut("x")}
				onSelect={() =>
					run(async () => {
						const markdown = serializeSelectedBlocksAsMarkdown(editor);
						if (!markdown) return;
						const copied = await copyTextToClipboard(markdown, {
							errorMessage: t("contextMenu.copyFailed"),
						});
						if (!copied) return;
						removeSelectedBlocks(editor);
					})
				}
			>
				<Scissors className="size-4" />
				{t("contextMenu.cut")}
			</MenuItem>
			<MenuItem
				onSelect={() => {
					run(() => {
						duplicateSelectedBlocks(editor);
					});
				}}
			>
				<CopyPlus className="size-4" />
				{t("blockDrag.duplicate")}
			</MenuItem>
			<div className="-mx-1 my-1 h-px bg-border" />
			<MenuItem
				destructive
				onSelect={() => {
					run(() => {
						removeSelectedBlocks(editor);
						editor.getApi(BlockSelectionPlugin).blockSelection.deselect();
					});
				}}
			>
				<Trash2 className="size-4" />
				{t("blockDrag.delete")}
			</MenuItem>
		</>
	);
}

/**
 * Notion 6-dot handle: hovering the handle opens the block action list;
 * click-hold and drag (via `handleRef`) moves the block.
 */
export function BlockHandleMenu({
	element,
	handleRef,
	isDragging,
	onMenuOpenChange,
	onPrepareDrag,
	style,
}: BlockHandleMenuProps) {
	const [open, setOpen] = useState(false);
	// A long note has one handle per block; mounting a Radix Popover root for each
	// of them up front is thousands of components nobody has hovered yet. Arm on
	// first pointer entry, release once the fade-out is done.
	const [mounted, setMounted] = useState(false);
	const closeTimerRef = useRef<number | null>(null);
	const unmountTimerRef = useRef<number | null>(null);

	const setMenuOpen = useCallback(
		(next: boolean) => {
			if (closeTimerRef.current != null) {
				window.clearTimeout(closeTimerRef.current);
				closeTimerRef.current = null;
			}
			if (unmountTimerRef.current != null) {
				window.clearTimeout(unmountTimerRef.current);
				unmountTimerRef.current = null;
			}
			if (next) {
				setMounted(true);
			} else {
				// Radix needs the root alive for the whole exit animation.
				unmountTimerRef.current = window.setTimeout(() => {
					unmountTimerRef.current = null;
					setMounted(false);
				}, MENU_UNMOUNT_MS);
			}
			setOpen(next);
			onMenuOpenChange?.(next);
		},
		[onMenuOpenChange],
	);

	const openMenu = useCallback(() => {
		// Hover must not rewrite block selection — that collapses a multi-select
		// into the hovered block. Actions/drag still resolve the set on invoke.
		setMenuOpen(true);
	}, [setMenuOpen]);

	const scheduleClose = useCallback(() => {
		if (closeTimerRef.current != null) {
			window.clearTimeout(closeTimerRef.current);
		}
		closeTimerRef.current = window.setTimeout(() => {
			setMenuOpen(false);
		}, MENU_CLOSE_MS);
	}, [setMenuOpen]);

	const closeMenu = useCallback(() => setMenuOpen(false), [setMenuOpen]);

	useEffect(() => {
		if (isDragging) setMenuOpen(false);
	}, [isDragging, setMenuOpen]);

	useEffect(
		() => () => {
			if (closeTimerRef.current != null) {
				window.clearTimeout(closeTimerRef.current);
			}
			if (unmountTimerRef.current != null) {
				window.clearTimeout(unmountTimerRef.current);
			}
		},
		[],
	);

	return (
		<div className="absolute top-0 left-0 h-6 w-full" style={style}>
			{/* Stays at this position in the tree whether or not the Popover is
			    mounted: remounting would drop the react-dnd drag connector, and it
			    would do so between pointerenter and mousedown. */}
			{/* Native <button> cannot start HTML5 drag. Connector lives here. */}
			{/* biome-ignore lint/a11y/useSemanticElements: HTML5 drag cannot start from <button> */}
			<div
				ref={handleRef}
				role="button"
				tabIndex={0}
				aria-label={i18n.t("editor:blockDrag.handle")}
				data-plate-prevent-deselect=""
				className={cn(
					"flex size-full items-center justify-center rounded-sm text-muted-foreground",
					"hover:bg-muted hover:text-foreground [&_svg]:pointer-events-none",
					isDragging ? "cursor-grabbing" : "cursor-grab",
				)}
				onPointerEnter={openMenu}
				onPointerLeave={scheduleClose}
				onMouseDown={(event) => {
					if (event.button !== 0 || event.shiftKey) return;
					event.preventDefault();
					window.getSelection()?.removeAllRanges();
					onPrepareDrag(event);
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						openMenu();
					}
				}}
			>
				<GripVertical className="size-3.5" aria-hidden />
			</div>
			{mounted ? (
				<Popover open={open && !isDragging} modal={false}>
					{/* Overlays the grip's box, so positioning matches anchoring the
					    grip itself — without reparenting it. */}
					<PopoverAnchor className="pointer-events-none absolute inset-0" />
					<PopoverContent
						side="left"
						align="start"
						sideOffset={6}
						className="w-44 gap-0 p-1"
						onOpenAutoFocus={(event) => event.preventDefault()}
						onPointerEnter={openMenu}
						onPointerLeave={scheduleClose}
					>
						<BlockHandleActions element={element} onDone={closeMenu} />
					</PopoverContent>
				</Popover>
			) : null}
		</div>
	);
}
