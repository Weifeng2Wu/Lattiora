import { ImageIcon, ScanSearch } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import type { PromptImage } from "@/lib/agent/api";
import type { ChatVisualAnnotation } from "@/lib/agent/chat-state";
import { cn } from "@/lib/core/utils";

function promptImageSrc(image: PromptImage): string | null {
	if (!image.data) return null;
	const mime = image.mimeType || "image/png";
	return `data:${mime};base64,${image.data}`;
}

function imageSrc(annotation: ChatVisualAnnotation): string | null {
	return promptImageSrc(annotation.image);
}

function chipLabel(
	annotation: ChatVisualAnnotation,
	fallback: string,
	pageLabel: string,
): string {
	const comment = annotation.comment.trim();
	if (comment) return comment;
	return `${fallback} · ${pageLabel}`;
}

/**
 * Message-row chips for visual annotations (Agent transcript + pin modal).
 * Image-only — comment/page text stays on the composer pending chips and in
 * the detail dialog. Click opens the crop + comment dialog.
 */
export function ChatVisualAnnotations({
	annotations,
	className,
}: {
	annotations: ChatVisualAnnotation[];
	className?: string;
}) {
	const { t } = useTranslation("agent");
	const [openId, setOpenId] = useState<string | null>(null);
	const open = useMemo(
		() => annotations.find((item) => item.id === openId) ?? null,
		[annotations, openId],
	);
	const openSrc = open ? imageSrc(open) : null;

	if (!annotations.length) return null;

	return (
		<>
			<div className={cn("flex flex-wrap justify-end gap-1.5", className)}>
				{annotations.map((annotation, index) => {
					const pageLabel = t("composer.visualAnnotationPage", {
						page: annotation.page,
					});
					const label = chipLabel(
						annotation,
						t("composer.visualAnnotation"),
						pageLabel,
					);
					const thumb = imageSrc(annotation);
					return (
						<button
							key={annotation.id}
							type="button"
							className="inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/80 bg-background/80 shadow-sm transition-colors hover:bg-muted"
							onClick={() => setOpenId(annotation.id)}
							title={t("composer.visualAnnotationOpen")}
							aria-label={t("composer.visualAnnotationOpenAria", {
								index: index + 1,
								label,
							})}
						>
							{thumb ? (
								<img src={thumb} alt="" className="size-full object-cover" />
							) : (
								<ScanSearch className="size-3.5 text-muted-foreground" />
							)}
						</button>
					);
				})}
			</div>

			<Dialog
				open={Boolean(open)}
				onOpenChange={(next) => {
					if (!next) setOpenId(null);
				}}
			>
				<DialogContent className="sm:max-w-md" aria-describedby={undefined}>
					{open ? (
						<>
							<DialogHeader>
								<DialogTitle>
									{t("composer.visualAnnotationDetailTitle", {
										index:
											annotations.findIndex((item) => item.id === open.id) + 1,
									})}
								</DialogTitle>
								<DialogDescription>
									{t("composer.visualAnnotationPage", { page: open.page })}
									{open.paperPath ? ` · ${open.paperPath}` : ""}
								</DialogDescription>
							</DialogHeader>
							{openSrc ? (
								<img
									src={openSrc}
									alt={t("composer.visualAnnotationPreviewAlt", {
										page: open.page,
									})}
									className="max-h-[min(60vh,28rem)] w-full rounded-lg border border-border/70 bg-muted/30 object-contain"
								/>
							) : null}
							<div className="space-y-1">
								<p className="font-medium text-muted-foreground text-xs">
									{t("composer.visualAnnotationCommentLabel")}
								</p>
								<p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
									{open.comment.trim() ||
										t("composer.visualAnnotationNoComment")}
								</p>
							</div>
						</>
					) : null}
				</DialogContent>
			</Dialog>
		</>
	);
}

/**
 * Message-row chips for general composer image attachments (paste / file pick).
 * Same image-only chip pattern as visual annotations; click opens a preview.
 */
export function ChatAttachedImages({
	images,
	className,
}: {
	images: PromptImage[];
	className?: string;
}) {
	const { t } = useTranslation("agent");
	const [openIndex, setOpenIndex] = useState<number | null>(null);
	const open =
		openIndex != null && openIndex >= 0 && openIndex < images.length
			? images[openIndex]
			: null;
	const openSrc = open ? promptImageSrc(open) : null;

	if (!images.length) return null;

	return (
		<>
			<div className={cn("flex flex-wrap justify-end gap-1.5", className)}>
				{images.map((image, index) => {
					const thumb = promptImageSrc(image);
					const key = `${image.mimeType}:${image.data.slice(0, 32)}:${index}`;
					return (
						<button
							key={key}
							type="button"
							className="inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/80 bg-background/80 shadow-sm transition-colors hover:bg-muted"
							onClick={() => setOpenIndex(index)}
							title={t("composer.attachedImageOpen")}
							aria-label={t("composer.attachedImageOpenAria", {
								index: index + 1,
							})}
						>
							{thumb ? (
								<img src={thumb} alt="" className="size-full object-cover" />
							) : (
								<ImageIcon className="size-3.5 text-muted-foreground" />
							)}
						</button>
					);
				})}
			</div>

			<Dialog
				open={open != null}
				onOpenChange={(next) => {
					if (!next) setOpenIndex(null);
				}}
			>
				<DialogContent className="sm:max-w-md" aria-describedby={undefined}>
					{open != null && openIndex != null ? (
						<>
							<DialogHeader>
								<DialogTitle>
									{t("composer.attachedImageDetailTitle", {
										index: openIndex + 1,
									})}
								</DialogTitle>
								<DialogDescription className="sr-only">
									{t("composer.attachedImagePreviewAlt", {
										index: openIndex + 1,
									})}
								</DialogDescription>
							</DialogHeader>
							{openSrc ? (
								<img
									src={openSrc}
									alt={t("composer.attachedImagePreviewAlt", {
										index: openIndex + 1,
									})}
									className="max-h-[min(60vh,28rem)] w-full rounded-lg border border-border/70 bg-muted/30 object-contain"
								/>
							) : null}
						</>
					) : null}
				</DialogContent>
			</Dialog>
		</>
	);
}

/** Plain-text export of free text + visual comments (copy / edit seed). */
export function formatUserLineForCopy(line: {
	text: string;
	visualAnnotations?: ChatVisualAnnotation[];
	images?: PromptImage[];
}): string {
	const parts: string[] = [];
	const free = line.text.trim();
	if (free) parts.push(free);
	const visuals = line.visualAnnotations ?? [];
	if (visuals.length) {
		parts.push(
			...visuals.map((item, index) => {
				const comment = item.comment.trim();
				return comment
					? `${index + 1}. ${comment}`
					: `${index + 1}. (p.${item.page})`;
			}),
		);
	}
	const images = line.images ?? [];
	if (images.length) {
		parts.push(
			images.length === 1
				? "(1 image attachment)"
				: `(${images.length} image attachments)`,
		);
	}
	return parts.join("\n");
}
