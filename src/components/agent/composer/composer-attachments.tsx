/**
 * Composer pieces that read the `usePromptInputAttachments` context — they must
 * stay rendered inside the `PromptInput` provider subtree.
 */
import { ImageIcon, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
	PromptInputButton,
	PromptInputSubmit,
	usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import {
	COMPOSER_IMAGE_MAX_BYTES,
	COMPOSER_IMAGE_MAX_FILES,
	pickComposerImageFiles,
} from "@/lib/agent/prompt-image";
import { notifyError } from "@/lib/core/notify";
import { cn } from "@/lib/core/utils";

/** Pending image attachment chips (inside PromptInput attachment context). */
export function ComposerImageAttachments({
	compact = false,
}: {
	compact?: boolean;
}) {
	const { t } = useTranslation("agent");
	const attachments = usePromptInputAttachments();
	if (attachments.files.length === 0) return null;
	return (
		<div
			className={cn(
				"mb-2 flex flex-wrap gap-1.5",
				compact &&
					"mb-0 max-w-[30%] shrink-0 flex-nowrap gap-1 overflow-hidden",
			)}
		>
			{attachments.files.map((file) => {
				const label = file.filename?.trim() || t("composer.attachedImage");
				const thumb = file.url || null;
				return (
					<button
						key={file.id}
						type="button"
						className={cn(
							"inline-flex items-center border bg-muted/20 text-foreground text-xs transition-colors hover:bg-muted",
							compact
								? "size-7 shrink-0 justify-center rounded-full p-0"
								: "h-8 max-w-full gap-1.5 rounded-full px-1.5 pr-2",
						)}
						onClick={() => attachments.remove(file.id)}
						title={t("composer.removeAttachedImage")}
					>
						{thumb ? (
							<img
								src={thumb}
								alt=""
								className={cn(
									"shrink-0 object-cover",
									compact ? "size-5 rounded-full" : "size-5 rounded",
								)}
							/>
						) : (
							<ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
						)}
						{compact ? null : (
							<>
								<span className="max-w-[10rem] truncate" title={label}>
									{label}
								</span>
								<X className="size-3 shrink-0 text-muted-foreground" />
							</>
						)}
					</button>
				);
			})}
		</div>
	);
}

export function ComposerAttachImageButton({
	disabled,
}: {
	disabled?: boolean;
}) {
	const { t } = useTranslation("agent");
	const attachments = usePromptInputAttachments();
	const [picking, setPicking] = useState(false);

	const onAttachClick = async () => {
		if (disabled || picking) return;
		const remaining = Math.max(
			0,
			COMPOSER_IMAGE_MAX_FILES - attachments.files.length,
		);
		if (remaining <= 0) {
			notifyError(t("composer.imageMaxFilesError"));
			return;
		}
		setPicking(true);
		try {
			// Desktop: native dialog with hard extension filters (PDF greyed out /
			// not listed). Non-Tauri: fall back to HTML file input + accept.
			const picked = await pickComposerImageFiles({
				remainingSlots: remaining,
				title: t("composer.attachImage"),
				filterName: t("composer.imageFilter"),
			});
			if (picked === null) {
				attachments.openFileDialog();
				return;
			}
			if (picked.length === 0) return;
			const oversized = picked.filter(
				(file) => file.size > COMPOSER_IMAGE_MAX_BYTES,
			);
			const sized = picked.filter(
				(file) => file.size <= COMPOSER_IMAGE_MAX_BYTES,
			);
			if (oversized.length && sized.length === 0) {
				notifyError(t("composer.imageMaxSizeError"));
				return;
			}
			if (oversized.length) {
				notifyError(t("composer.imageMaxSizeError"));
			}
			if (sized.length) {
				attachments.add(sized);
			}
		} catch (error) {
			notifyError(
				error instanceof Error ? error.message : t("composer.imagePickFailed"),
			);
		} finally {
			setPicking(false);
		}
	};

	return (
		<PromptInputButton
			type="button"
			className="size-7 text-foreground"
			disabled={disabled || picking}
			onClick={() => void onAttachClick()}
			tooltip={t("composer.attachImage")}
			aria-label={t("composer.attachImage")}
		>
			<ImageIcon className="size-3.5" />
		</PromptInputButton>
	);
}

export function ComposerSubmitControl({
	canSubmitBase,
	switching,
	submitting,
	activeTabIsRunning,
	compact = false,
	onCancelRun,
}: {
	canSubmitBase: boolean;
	switching: boolean;
	submitting: boolean;
	activeTabIsRunning: boolean;
	compact?: boolean;
	onCancelRun: () => void;
}) {
	const attachments = usePromptInputAttachments();
	const canSubmit = canSubmitBase || attachments.files.length > 0;
	// Streaming + empty composer → stop; with text/images/drafts → queue follow-up.
	const stop = activeTabIsRunning && !canSubmit;
	const idleEmpty = !stop && !canSubmit;
	return (
		<PromptInputSubmit
			className={cn(
				// Filled circle: match attach/context footprint (`size-7`); solid fill like ChatGPT send.
				"size-7 shrink-0 rounded-full border-0 shadow-none disabled:opacity-100",
				// Compact: vertically centered in the single-line row.
				// Expanded: footer end. Shared bottom inset via py-2.5 / pb-2.5.
				compact ? "self-center" : "ml-auto",
				idleEmpty
					? "bg-muted text-muted-foreground/55 hover:bg-muted"
					: "bg-foreground text-background hover:bg-foreground/90",
			)}
			size="icon-xs"
			variant="ghost"
			status={
				stop
					? "streaming"
					: submitting && !activeTabIsRunning
						? "submitted"
						: "ready"
			}
			onStop={stop ? onCancelRun : undefined}
			disabled={switching || (submitting && !activeTabIsRunning) || idleEmpty}
		/>
	);
}
