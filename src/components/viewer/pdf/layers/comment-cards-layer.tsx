/**
 * Comment rail: one persistent card per annotated highlight / visual note,
 * pinned just outside the page's right edge (`left: 100%` inside the
 * overflow-visible page container, same trick as PageTranslateTab). Cards
 * stack vertically with collision avoidance and clamp into the page height.
 *
 * Click a card to edit the note in place (Notion-style): the body becomes a
 * textarea, ⌘/Ctrl+Enter or blur saves, Escape cancels. No floating editor.
 */

import {
	Crop,
	Link2,
	MessageSquare,
	MessageSquarePlus,
	Trash2,
} from "lucide-react";
import {
	type CSSProperties,
	memo,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
	PageAnnotationComment,
	SelectionCommentDraft,
} from "@/components/viewer/pdf/types";
import { useImeGuard } from "@/hooks/use-ime-guard";
import { cn } from "@/lib/core/utils";
import type { PdfAskNormalizedRect } from "@/lib/pdf/ask/types";
import {
	DEFAULT_HIGHLIGHT_COLOR,
	swatchColorClass,
} from "@/lib/pdf/highlight/palette";
/** Card width in CSS px — also the gutter width reserved on the viewport. */
export const COMMENT_CARD_WIDTH_PX = 192;
/** Horizontal gap between the page edge and the rail. */
export const COMMENT_CARD_GAP_PX = 8;
/** Extra px so ring + shadow aren't clipped by the viewport overflow. */
const COMMENT_RAIL_BLEED_PX = 4;
/** Viewport right padding that keeps the rail clear of horizontal scroll. */
export const COMMENT_RAIL_WIDTH_PX =
	COMMENT_CARD_WIDTH_PX + COMMENT_CARD_GAP_PX + COMMENT_RAIL_BLEED_PX;

const CARD_GAP_PX = 8;
/** text-xs leading-relaxed ≈ 12px × 1.625. */
const CARD_LINE_HEIGHT_PX = 20;
/** Conservative chars per line at w-56 with padding (CJK-heavy notes). */
const CARD_CHARS_PER_LINE = 15;
/** Padding + color-dot row + blockquote/comment margins. */
const CARD_BASE_HEIGHT_PX = 54;
/** View-mode clamp for the note body. */
const VIEW_COMMENT_LINES = 3;
/** View-mode clamp for the inline visual-mark conversation preview. */
const VIEW_CONVERSATION_PREVIEW_LINES = 3;
/** In-place editor: min rows so an empty new note has room to type. */
const EDIT_MIN_COMMENT_LINES = 2;
/** In-place editor: layout estimate cap; textarea scrolls past this. */
const EDIT_MAX_COMMENT_LINES = 6;
const COMMENT_CARD_SURFACE_CLASS =
	"group pointer-events-auto absolute select-none rounded-lg border border-white/55 bg-background/88 shadow-[0_10px_28px_rgba(15,23,42,0.16),0_2px_8px_rgba(15,23,42,0.1)] ring-1 ring-black/5 backdrop-blur-xl backdrop-saturate-150 transition-[box-shadow,background-color,transform] duration-150 ease-out hover:z-[7] hover:shadow-[0_16px_36px_rgba(15,23,42,0.2),0_4px_12px_rgba(15,23,42,0.12)] hover:!h-auto supports-backdrop-blur:bg-background/70 dark:border-white/10 dark:shadow-[0_12px_32px_rgba(0,0,0,0.45),0_2px_10px_rgba(0,0,0,0.35)] dark:hover:shadow-[0_18px_40px_rgba(0,0,0,0.55),0_4px_14px_rgba(0,0,0,0.42)] dark:ring-white/10";
const COMMENT_DRAFT_SURFACE_CLASS =
	"group/draft pointer-events-auto absolute z-[6] cursor-text overflow-hidden rounded-lg border border-white/55 bg-background/88 text-left shadow-[0_10px_28px_rgba(15,23,42,0.16),0_2px_8px_rgba(15,23,42,0.1)] ring-1 ring-black/5 backdrop-blur-xl backdrop-saturate-150 outline-none supports-backdrop-blur:bg-background/70 dark:border-white/10 dark:shadow-[0_12px_32px_rgba(0,0,0,0.45),0_2px_10px_rgba(0,0,0,0.35)] dark:ring-white/10";
const COMMENT_ACTION_BAR_CLASS =
	"absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-md border border-white/50 bg-background/82 p-0.5 shadow-[0_6px_18px_rgba(15,23,42,0.14)] ring-1 ring-black/5 backdrop-blur-xl backdrop-saturate-150 transition-opacity duration-150 dark:border-white/10 dark:shadow-[0_8px_20px_rgba(0,0,0,0.4)] dark:ring-white/10";

type CommentCardsLayerProps = {
	/** Comments for this page only. */
	items: PageAnnotationComment[];
	/** Rendered page width in px (zoom-aware); used by the hover connector. */
	pageWidthPx: number;
	/** Rendered page height in px (zoom-aware). */
	pageHeightPx: number;
	/** Id of the card currently being edited in place; null when idle. */
	editingId: string | null;
	/** Resolvable wiki target; copy buttons only render when set. */
	wikiTarget: string | null;
	/** Id of the card currently being hovered; null when idle. */
	hoveredId: string | null;
	/**
	 * Sticky chip for the active (or just-cleared) text selection. Hover enters
	 * edit; leave with empty text collapses back to the icon card.
	 */
	selectionDraft?: SelectionCommentDraft | null;
	/** Persist a note from `selectionDraft` (non-empty text only). */
	onCommitSelectionComment?: (comment: string) => void;
	/** Chip was hovered / focused — keeps the sticky draft after selection clear. */
	onSelectionCommentActiveChange?: (active: boolean) => void;
	/** Drop the sticky draft (Escape). */
	onDismissSelectionComment?: () => void;
	onOpen: (comment: PageAnnotationComment) => void;
	onSave: (comment: PageAnnotationComment, text: string) => void;
	onCancel: () => void;
	onDelete: (comment: PageAnnotationComment) => void;
	onCopyLink: (comment: PageAnnotationComment) => void;
	onCopyEmbed: (comment: PageAnnotationComment) => void;
	/** Add this visual mark's crop to the Agent sidebar composer (#396). */
	onAddToChat: (comment: PageAnnotationComment) => void;
	onHover: (comment: PageAnnotationComment) => void;
	onLeave: () => void;
};

export type CommentCardPlacement = {
	id: string;
	topPx: number;
	heightPx: number;
};

/** Visual line count after clamping (comment: view 3 / edit 12). */
function clampedLines(text: string, max: number): number {
	let lines = 0;
	for (const raw of text.split("\n")) {
		lines += Math.max(1, Math.ceil(raw.length / CARD_CHARS_PER_LINE));
		if (lines >= max) return max;
	}
	return Math.max(1, lines);
}

/** Conservative card height estimate from clamped comment + conversation lines. */
export function estimateCommentCardHeight(
	item: PageAnnotationComment,
	editing = false,
): number {
	const commentLines = editing
		? Math.max(
				EDIT_MIN_COMMENT_LINES,
				clampedLines(item.comment, EDIT_MAX_COMMENT_LINES),
			)
		: clampedLines(item.comment, VIEW_COMMENT_LINES);
	const conversationPreviewLines =
		!editing && item.messages && item.messages.length > 0
			? Math.min(
					VIEW_CONVERSATION_PREVIEW_LINES,
					item.messages.reduce(
						(sum, m) => sum + clampedLines(m.content, VIEW_COMMENT_LINES),
						0,
					),
				)
			: 0;
	return (
		CARD_BASE_HEIGHT_PX +
		commentLines * CARD_LINE_HEIGHT_PX +
		conversationPreviewLines * CARD_LINE_HEIGHT_PX
	);
}

/**
 * Anchor each card at its highlight height, then nudge overlapping cards
 * downward (never sideways) and clamp the whole stack into the page height.
 */
export function layoutCommentCards(
	items: PageAnnotationComment[],
	pageHeightPx: number,
	editingId?: string | null,
): CommentCardPlacement[] {
	const sorted = [...items].sort(
		(a, b) => a.anchorY - b.anchorY || a.id.localeCompare(b.id),
	);
	const laid: CommentCardPlacement[] = [];

	for (const item of sorted) {
		const heightPx = estimateCommentCardHeight(item, item.id === editingId);
		const anchorTop = item.anchorY * pageHeightPx;
		const prev = laid[laid.length - 1];
		const topPx = Math.max(
			anchorTop,
			prev ? prev.topPx + prev.heightPx + CARD_GAP_PX : 0,
		);
		laid.push({ id: item.id, topPx, heightPx });
	}

	// Clamp the stack into the page: shift cards up bottom-first, keeping the
	// avoidance gap between neighbours.
	for (let i = laid.length - 1; i >= 0; i -= 1) {
		const card = laid[i];
		const next = laid[i + 1];
		const maxTop = next
			? next.topPx - CARD_GAP_PX - card.heightPx
			: pageHeightPx - card.heightPx;
		card.topPx = Math.max(0, Math.min(card.topPx, maxTop));
	}

	return laid;
}

/**
 * Word / Feishu-style orthogonal leader from the nearest highlight segment to
 * the laid-out card's left midpoint, folding at the page's right edge.
 * Multi-line highlights pick the rect closest to the card (not the envelope mid).
 * Returns an SVG path `d` in page-pixel coordinates, or null when undrawable.
 */
export function commentConnectorPath(
	rects: readonly PdfAskNormalizedRect[],
	placement: CommentCardPlacement,
	pageWidthPx: number,
	pageHeightPx: number,
	railLeft = pageWidthPx + COMMENT_CARD_GAP_PX,
): string | null {
	if (rects.length === 0 || pageWidthPx <= 0 || pageHeightPx <= 0) return null;

	const round = (n: number) => Math.round(n * 100) / 100;
	const y2 = placement.topPx + placement.heightPx / 2;
	const y2Norm = y2 / pageHeightPx;

	let best = rects[0];
	let bestDist = Number.POSITIVE_INFINITY;
	for (const rect of rects) {
		const top = rect.y;
		const bottom = rect.y + rect.h;
		// Distance from the card mid to the closest point inside this segment.
		const clamped = Math.min(Math.max(y2Norm, top), bottom);
		const dist = Math.abs(clamped - y2Norm);
		const right = rect.x + rect.w;
		const bestRight = best.x + best.w;
		if (
			dist < bestDist ||
			(dist === bestDist &&
				(right > bestRight || (right === bestRight && rect.y < best.y)))
		) {
			best = rect;
			bestDist = dist;
		}
	}

	const attachYNorm = Math.min(Math.max(y2Norm, best.y), best.y + best.h);
	const x1 = round((best.x + best.w) * pageWidthPx);
	const y1 = round(attachYNorm * pageHeightPx);
	const xMid = round(pageWidthPx);
	const x2 = round(railLeft);
	const y2Rounded = round(y2);

	return `M ${x1} ${y1} L ${xMid} ${y1} L ${xMid} ${y2Rounded} L ${x2} ${y2Rounded}`;
}

function autosizeTextarea(el: HTMLTextAreaElement | null) {
	if (!el) return;
	el.style.height = "0px";
	el.style.height = `${Math.max(el.scrollHeight, CARD_LINE_HEIGHT_PX * EDIT_MIN_COMMENT_LINES)}px`;
}

type CommentCardProps = {
	item: PageAnnotationComment;
	topPx: number;
	heightPx: number;
	editing: boolean;
	wikiTarget: string | null;
	hovered: boolean;
	onOpen: (comment: PageAnnotationComment) => void;
	onSave: (comment: PageAnnotationComment, text: string) => void;
	onCancel: () => void;
	onDelete: (comment: PageAnnotationComment) => void;
	onCopyLink: (comment: PageAnnotationComment) => void;
	onCopyEmbed: (comment: PageAnnotationComment) => void;
	onAddToChat: (comment: PageAnnotationComment) => void;
	onHover: (comment: PageAnnotationComment) => void;
	onLeave: () => void;
};

const CommentCard = memo(function CommentCard({
	item,
	topPx,
	heightPx,
	editing,
	wikiTarget,
	hovered,
	onOpen,
	onSave,
	onCancel,
	onDelete,
	onCopyLink,
	onCopyEmbed,
	onAddToChat,
	onHover,
	onLeave,
}: CommentCardProps) {
	const { t } = useTranslation("viewer");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const cancelledRef = useRef(false);
	const itemRef = useRef(item);
	itemRef.current = item;
	const onSaveRef = useRef(onSave);
	onSaveRef.current = onSave;
	const draftRef = useRef(item.comment);
	const commentSeedRef = useRef(item.comment);
	commentSeedRef.current = item.comment;
	const { isBlockedByIme, compositionProps } = useImeGuard();

	useEffect(() => {
		if (!editing) return;
		cancelledRef.current = false;
		draftRef.current = commentSeedRef.current;
		const el = textareaRef.current;
		if (!el) return;
		el.focus();
		const len = el.value.length;
		el.setSelectionRange(len, len);
		autosizeTextarea(el);
	}, [editing]);

	// Page virtualization unmounts the card if the user scrolls away — treat
	// dirty drafts like blur and commit. Skip no-op saves so React StrictMode's
	// fake unmount doesn't close a freshly opened editor.
	useEffect(() => {
		if (!editing) return;
		return () => {
			if (cancelledRef.current) return;
			if (draftRef.current === commentSeedRef.current) return;
			onSaveRef.current(itemRef.current, draftRef.current);
		};
	}, [editing]);

	const commit = (text: string) => {
		cancelledRef.current = true;
		draftRef.current = text;
		onSave(item, text);
	};

	const cancel = () => {
		cancelledRef.current = true;
		onCancel();
	};

	return (
		<div
			data-pdf-chrome
			className={cn(
				COMMENT_CARD_SURFACE_CLASS,
				!editing && "max-h-[70vh] overflow-y-auto",
				editing
					? "z-[6] bg-background/92 shadow-[0_18px_44px_rgba(15,23,42,0.22),0_4px_16px_rgba(15,23,42,0.12)] ring-2 ring-ring/50 dark:shadow-[0_18px_46px_rgba(0,0,0,0.6),0_4px_16px_rgba(0,0,0,0.45)]"
					: hovered
						? "z-[6] bg-background/92 shadow-[0_18px_44px_rgba(15,23,42,0.22),0_4px_16px_rgba(15,23,42,0.12)] ring-2 ring-primary/45 dark:shadow-[0_18px_46px_rgba(0,0,0,0.6),0_4px_16px_rgba(0,0,0,0.45)]"
						: "",
			)}
			style={{
				left: "var(--comment-rail-left)",
				top: topPx,
				width: COMMENT_CARD_WIDTH_PX,
				height: editing ? undefined : heightPx,
				minHeight: heightPx,
			}}
			onPointerEnter={() => onHover(item)}
			onPointerLeave={onLeave}
		>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: blur/pointer isolation for the in-place editor */}
			<div
				className={cn(
					"h-full rounded-[inherit] px-2.5 py-2",
					editing
						? "overflow-visible"
						: "overflow-hidden group-hover:overflow-visible",
				)}
				onPointerDown={(e) => e.stopPropagation()}
				onBlur={
					editing
						? (e) => {
								if (e.currentTarget.contains(e.relatedTarget as Node | null)) {
									return;
								}
								if (cancelledRef.current) return;
								commit(textareaRef.current?.value ?? "");
							}
						: undefined
				}
			>
				{editing ? (
					<div className="block w-full text-left">
						{item.kind === "visual" ? (
							<Crop className="size-2.5 text-muted-foreground" aria-hidden />
						) : (
							<span
								className={cn(
									"block size-2 rounded-full",
									swatchColorClass(item.color),
								)}
								aria-hidden
							/>
						)}
						<textarea
							ref={textareaRef}
							className="mt-1 max-h-32 w-full resize-none bg-transparent p-0 text-sm text-foreground/80 leading-relaxed outline-none placeholder:text-muted-foreground/70 select-text"
							placeholder={t("annotations.placeholder")}
							aria-label={t("annotations.editorLabel")}
							defaultValue={item.comment}
							rows={EDIT_MIN_COMMENT_LINES}
							{...compositionProps}
							onChange={(e) => {
								draftRef.current = e.currentTarget.value;
								autosizeTextarea(e.currentTarget);
							}}
							onClick={(e) => e.stopPropagation()}
							onKeyDown={(e) => {
								e.stopPropagation();
								if (e.key === "Escape") {
									e.preventDefault();
									cancel();
									return;
								}
								if (
									e.key === "Enter" &&
									(e.metaKey || e.ctrlKey) &&
									!isBlockedByIme(e)
								) {
									e.preventDefault();
									commit(e.currentTarget.value);
								}
							}}
						/>
					</div>
				) : (
					// biome-ignore lint/a11y/useSemanticElements: a native <button> cannot wrap the blockquote/p flow content
					<div
						role="button"
						tabIndex={0}
						className="block w-full cursor-text text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
						onClick={(e) => {
							e.stopPropagation();
							if ((e.target as Element).closest("a, button")) return;
							onOpen(item);
						}}
						onKeyDown={(e) => {
							if (e.target !== e.currentTarget) return;
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onOpen(item);
							}
						}}
					>
						{item.kind === "visual" ? (
							<Crop className="size-2.5 text-muted-foreground" aria-hidden />
						) : (
							<span
								className={cn(
									"block size-2 rounded-full",
									swatchColorClass(item.color),
								)}
								aria-hidden
							/>
						)}
						<div
							className={cn(
								"mt-1 max-h-[3.75rem] overflow-hidden break-words text-sm leading-relaxed group-hover:max-h-none group-hover:overflow-x-auto",
								item.comment.trim()
									? "text-foreground/80"
									: "text-muted-foreground/70",
							)}
						>
							{item.comment.trim() ? (
								<MessageResponse className="text-sm leading-relaxed [&_p]:my-0 [&_table]:min-w-max">
									{item.comment}
								</MessageResponse>
							) : (
								t("annotations.placeholder")
							)}
						</div>
						{item.messages && item.messages.length > 0 ? (
							<div className="mt-1.5 border-t border-border/40 pt-1.5">
								<div className="line-clamp-3 space-y-1 group-hover:line-clamp-none">
									{item.messages.map((m) => (
										<p
											key={m.id}
											className={cn(
												"whitespace-pre-wrap break-words text-caption leading-relaxed",
												m.role === "assistant"
													? "text-muted-foreground"
													: "text-foreground/80",
											)}
										>
											{m.content}
										</p>
									))}
								</div>
							</div>
						) : null}
					</div>
				)}
				<div
					className={cn(
						COMMENT_ACTION_BAR_CLASS,
						editing
							? "opacity-0 group-hover:opacity-100"
							: "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
					)}
				>
					{wikiTarget ? (
						<>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										className="size-6 text-muted-foreground hover:text-foreground"
										aria-label={t("annotations.copyLink")}
										onClick={(e) => {
											e.stopPropagation();
											onCopyLink(item);
										}}
									>
										<Link2 className="size-3.5" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>{t("annotations.copyLink")}</TooltipContent>
							</Tooltip>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										className="size-6 text-muted-foreground hover:text-foreground"
										aria-label={t("annotations.copyEmbed")}
										onClick={(e) => {
											e.stopPropagation();
											onCopyEmbed(item);
										}}
									>
										<span className="font-mono text-caption leading-none">
											![[
										</span>
									</Button>
								</TooltipTrigger>
								<TooltipContent>{t("annotations.copyEmbed")}</TooltipContent>
							</Tooltip>
						</>
					) : null}
					{item.kind === "visual" ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									className="size-6 text-muted-foreground hover:text-foreground"
									aria-label={t("pdfExplain.addToSidebarChat")}
									onClick={(e) => {
										e.stopPropagation();
										onAddToChat(item);
									}}
								>
									<MessageSquarePlus className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								{t("pdfExplain.addToSidebarChat")}
							</TooltipContent>
						</Tooltip>
					) : null}
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								className="size-6 text-muted-foreground hover:text-destructive"
								aria-label={t("annotations.delete")}
								onClick={(e) => {
									e.stopPropagation();
									cancelledRef.current = true;
									onDelete(item);
								}}
							>
								<Trash2 className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>{t("annotations.delete")}</TooltipContent>
					</Tooltip>
				</div>
			</div>
		</div>
	);
});

type SelectionCommentAffordanceProps = {
	draft: SelectionCommentDraft;
	pageHeightPx: number;
	onCommit: (comment: string) => void;
	onActiveChange?: (active: boolean) => void;
	/** Dismiss the sticky draft (Escape with empty text). */
	onDismiss?: () => void;
};

/**
 * Collapsed icon chip at the selection's rail height.
 * Hover → expand and enter edit (focus textarea).
 * Leave with no input → collapse back to the icon card.
 * Leave with input → stay in edit until commit / blur / Escape.
 */
const SelectionCommentAffordance = memo(function SelectionCommentAffordance({
	draft,
	pageHeightPx,
	onCommit,
	onActiveChange,
	onDismiss,
}: SelectionCommentAffordanceProps) {
	const { t } = useTranslation("viewer");
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const draftTextRef = useRef("");
	const committedRef = useRef(false);
	const onCommitRef = useRef(onCommit);
	onCommitRef.current = onCommit;
	const onActiveChangeRef = useRef(onActiveChange);
	onActiveChangeRef.current = onActiveChange;
	const onDismissRef = useRef(onDismiss);
	onDismissRef.current = onDismiss;
	const { isBlockedByIme, compositionProps } = useImeGuard();

	const editing = hovered || focused;
	const heightPx = estimateCommentCardHeight(
		{
			id: "__selection-draft__",
			pageIndex: draft.page - 1,
			anchorY: draft.anchorY,
			rects: [],
			quote: draft.quote,
			comment: "",
			color: DEFAULT_HIGHLIGHT_COLOR,
			kind: "highlight",
			linkAlias: null,
		},
		editing,
	);
	const topPx = Math.max(
		0,
		Math.min(draft.anchorY * pageHeightPx, pageHeightPx - heightPx),
	);

	const enterEdit = useCallback(() => {
		if (committedRef.current) return;
		setHovered(true);
		setFocused(true);
		// Mark sticky before focus so EmbedPDF clearing the selection does not
		// unmount this chip mid-hover.
		onActiveChangeRef.current?.(true);
		requestAnimationFrame(() => {
			const el = textareaRef.current;
			if (!el) return;
			el.focus();
			autosizeTextarea(el);
		});
	}, []);

	const collapseToCard = useCallback(() => {
		draftTextRef.current = "";
		if (textareaRef.current) textareaRef.current.value = "";
		setFocused(false);
		setHovered(false);
		// Keep sticky draft so the icon card remains after selection was cleared.
		onActiveChangeRef.current?.(true);
	}, []);

	const commit = useCallback((text: string) => {
		if (committedRef.current) return;
		const trimmed = text.trim();
		if (!trimmed) return;
		committedRef.current = true;
		onActiveChangeRef.current?.(false);
		onCommitRef.current(trimmed);
	}, []);

	useEffect(() => {
		return () => {
			onActiveChangeRef.current?.(false);
		};
	}, []);

	return (
		// biome-ignore lint/a11y/useSemanticElements: hosts a textarea; native <button> cannot wrap it
		<div
			ref={rootRef}
			role="group"
			aria-label={t("selection.note")}
			data-pdf-chrome
			className={cn(
				COMMENT_DRAFT_SURFACE_CLASS,
				"transition-[width,box-shadow,background-color] duration-200 ease-out motion-reduce:transition-none",
				editing
					? "z-[7] bg-background/92 shadow-[0_18px_44px_rgba(15,23,42,0.22),0_4px_16px_rgba(15,23,42,0.12)] ring-2 ring-primary/45 dark:shadow-[0_18px_46px_rgba(0,0,0,0.6),0_4px_16px_rgba(0,0,0,0.45)]"
					: "w-9 select-none hover:shadow-[0_14px_34px_rgba(15,23,42,0.2),0_3px_12px_rgba(15,23,42,0.12)] dark:hover:shadow-[0_14px_34px_rgba(0,0,0,0.5),0_3px_12px_rgba(0,0,0,0.4)]",
				focused && "ring-2 ring-ring/50",
			)}
			style={{
				left: "var(--comment-rail-left)",
				top: topPx,
				width: editing ? COMMENT_CARD_WIDTH_PX : 36,
				height: editing ? undefined : 36,
				minHeight: editing ? heightPx : 36,
			}}
			onPointerDown={(e) => {
				// Page-local hit: stop EmbedPDF from treating this as click-away
				// before the textarea can take focus. Do not preventDefault.
				e.stopPropagation();
			}}
			onPointerEnter={() => enterEdit()}
			onPointerLeave={(e) => {
				const next = e.relatedTarget as Node | null;
				if (next && rootRef.current?.contains(next)) return;
				if (draftTextRef.current.trim()) {
					// Has input: stay in edit (focused) even if the pointer left.
					setHovered(false);
					return;
				}
				// No input: collapse back to the icon card.
				collapseToCard();
				textareaRef.current?.blur();
			}}
		>
			<span
				className={cn(
					"absolute inset-0 flex items-center justify-center text-muted-foreground transition-opacity duration-150",
					editing && "pointer-events-none opacity-0",
				)}
				aria-hidden
			>
				<MessageSquare className="size-4" />
			</span>
			<div
				className={cn(
					"w-full px-2.5 py-2 transition-opacity duration-150",
					editing ? "opacity-100" : "opacity-0",
				)}
			>
				<span
					className={cn(
						"block size-2 rounded-full",
						swatchColorClass(DEFAULT_HIGHLIGHT_COLOR),
					)}
					aria-hidden
				/>
				<textarea
					ref={textareaRef}
					className="mt-1 max-h-32 w-full resize-none bg-transparent p-0 text-sm text-foreground/80 leading-relaxed outline-none placeholder:text-muted-foreground/70 select-text"
					placeholder={t("annotations.placeholder")}
					aria-label={t("annotations.editorLabel")}
					rows={EDIT_MIN_COMMENT_LINES}
					tabIndex={editing ? 0 : -1}
					{...compositionProps}
					onFocus={() => {
						setFocused(true);
						onActiveChangeRef.current?.(true);
					}}
					onChange={(e) => {
						draftTextRef.current = e.currentTarget.value;
						autosizeTextarea(e.currentTarget);
					}}
					onBlur={(e) => {
						const next = e.relatedTarget as Node | null;
						if (next && rootRef.current?.contains(next)) return;
						const text = draftTextRef.current;
						if (text.trim()) {
							commit(text);
							return;
						}
						// Empty blur (e.g. leave hover): back to icon card.
						collapseToCard();
					}}
					onClick={(e) => e.stopPropagation()}
					onPointerDown={(e) => e.stopPropagation()}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === "Escape") {
							e.preventDefault();
							draftTextRef.current = "";
							e.currentTarget.value = "";
							setFocused(false);
							setHovered(false);
							onActiveChangeRef.current?.(false);
							onDismissRef.current?.();
							e.currentTarget.blur();
							return;
						}
						if (
							e.key === "Enter" &&
							(e.metaKey || e.ctrlKey) &&
							!isBlockedByIme(e)
						) {
							e.preventDefault();
							commit(e.currentTarget.value);
						}
					}}
				/>
			</div>
		</div>
	);
});

export const CommentCardsLayer = memo(function CommentCardsLayer({
	items,
	pageWidthPx,
	pageHeightPx,
	editingId,
	wikiTarget,
	hoveredId,
	selectionDraft = null,
	onCommitSelectionComment,
	onSelectionCommentActiveChange,
	onDismissSelectionComment,
	onOpen,
	onSave,
	onCancel,
	onDelete,
	onCopyLink,
	onCopyEmbed,
	onAddToChat,
	onHover,
	onLeave,
}: CommentCardsLayerProps) {
	const layerRef = useRef<HTMLDivElement>(null);
	const [railLeft, setRailLeft] = useState(pageWidthPx + COMMENT_CARD_GAP_PX);
	const hasCards = items.length > 0 || !!selectionDraft;
	useEffect(() => {
		if (!hasCards) return;
		const layer = layerRef.current;
		const viewport = layer?.closest<HTMLElement>("[data-pdf-viewport]");
		if (!layer || !viewport) return;
		const update = () => {
			const page = layer.getBoundingClientRect();
			const bounds = viewport.getBoundingClientRect();
			const scale = page.width / pageWidthPx || 1;
			const visibleRight = Math.min(bounds.right, window.innerWidth);
			setRailLeft(
				Math.max(
					0,
					Math.min(
						pageWidthPx + COMMENT_CARD_GAP_PX,
						(visibleRight - page.left) / scale -
							COMMENT_CARD_WIDTH_PX -
							COMMENT_CARD_GAP_PX,
					),
				),
			);
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(viewport);
		observer.observe(layer);
		viewport.addEventListener("scroll", update, { passive: true });
		window.addEventListener("resize", update);
		return () => {
			observer.disconnect();
			viewport.removeEventListener("scroll", update);
			window.removeEventListener("resize", update);
		};
	}, [pageWidthPx, hasCards]);
	if (!hasCards) return null;

	const laid = layoutCommentCards(items, pageHeightPx, editingId);
	const byId = new Map(items.map((item) => [item.id, item]));
	const hoveredPlacement = hoveredId
		? (laid.find((pos) => pos.id === hoveredId) ?? null)
		: null;
	const hoveredItem = hoveredId ? (byId.get(hoveredId) ?? null) : null;
	const connectorD =
		hoveredItem && hoveredPlacement
			? commentConnectorPath(
					hoveredItem.rects,
					hoveredPlacement,
					pageWidthPx,
					pageHeightPx,
					railLeft,
				)
			: null;
	const svgWidth = pageWidthPx + COMMENT_CARD_GAP_PX + COMMENT_CARD_WIDTH_PX;

	return (
		<div
			ref={layerRef}
			style={{ "--comment-rail-left": `${railLeft}px` } as CSSProperties}
			className="pointer-events-none absolute inset-0 z-[5] overflow-visible"
		>
			{connectorD ? (
				// Decorative hover leader; announced via the card / hit-target labels.
				// biome-ignore lint/a11y/noSvgWithoutTitle: purely visual connector
				<svg
					aria-hidden
					focusable="false"
					className="pointer-events-none absolute top-0 left-0 overflow-visible"
					width={svgWidth}
					height={pageHeightPx}
					viewBox={`0 0 ${svgWidth} ${pageHeightPx}`}
				>
					<path
						d={connectorD}
						fill="none"
						className="stroke-background/95 dark:stroke-background/90"
						strokeWidth={5}
						strokeLinecap="round"
						strokeLinejoin="round"
						vectorEffect="non-scaling-stroke"
					/>
					<path
						d={connectorD}
						fill="none"
						className="stroke-default-primary/85"
						strokeWidth={2.5}
						strokeLinecap="round"
						strokeLinejoin="round"
						vectorEffect="non-scaling-stroke"
					/>
				</svg>
			) : null}
			<TooltipProvider delayDuration={200}>
				{laid.map((pos) => {
					const item = byId.get(pos.id);
					if (!item) return null;
					return (
						<CommentCard
							key={item.id}
							item={item}
							topPx={pos.topPx}
							heightPx={pos.heightPx}
							editing={item.id === editingId}
							wikiTarget={wikiTarget}
							hovered={item.id === hoveredId}
							onOpen={onOpen}
							onSave={onSave}
							onCancel={onCancel}
							onDelete={onDelete}
							onCopyLink={onCopyLink}
							onCopyEmbed={onCopyEmbed}
							onAddToChat={onAddToChat}
							onHover={onHover}
							onLeave={onLeave}
						/>
					);
				})}
				{selectionDraft && onCommitSelectionComment ? (
					<SelectionCommentAffordance
						draft={selectionDraft}
						pageHeightPx={pageHeightPx}
						onCommit={onCommitSelectionComment}
						onActiveChange={onSelectionCommentActiveChange}
						onDismiss={onDismissSelectionComment}
					/>
				) : null}
			</TooltipProvider>
		</div>
	);
});
