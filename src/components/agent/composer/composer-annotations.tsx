import { MessageSquare, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SelectionSourceButton } from "@/components/selection/selection-source-button";
import { Button } from "@/components/ui/button";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
	extractSelectionTokens,
	updateSelectionToken,
	withoutSelectionTokens,
} from "@/lib/agent/composer-inline-tokens";
import {
	annotationStore,
	releaseAnnotationAnchor,
} from "@/lib/agent/selection-annotations";
import {
	openAnnotationEditor,
	selectionChatStore,
	suspendSelectionChat,
} from "@/lib/agent/selection-chat-store";

export function ComposerAnnotations({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}) {
	const { t } = useTranslation(["viewer", "common"]);
	const [open, setOpen] = useState(false);
	const selections = useMemo(() => extractSelectionTokens(value), [value]);
	useEffect(() => {
		const binding = {
			selections,
			update: (id: string, comment: string | null) =>
				onChange(updateSelectionToken(value, id, comment)),
		};
		annotationStore.setState({ binding });
		const draft = selectionChatStore.getState().draft;
		if (draft?.editing && !selections.some((s) => s.id === draft.selection.id))
			suspendSelectionChat();
		return () => {
			if (annotationStore.getState().binding === binding)
				annotationStore.setState({ binding: null });
		};
	}, [selections, value, onChange]);
	const remove = (id?: string) => {
		for (const selection of selections)
			if (!id || selection.id === id) releaseAnnotationAnchor(selection.id);
		onChange(
			id
				? updateSelectionToken(value, id, null)
				: withoutSelectionTokens(value),
		);
	};
	if (!selections.length) return null;
	return (
		<HoverCard
			open={open}
			onOpenChange={setOpen}
			openDelay={150}
			closeDelay={180}
		>
			<div
				className="flex w-full items-center gap-1 px-3 pt-2"
				data-annotation-ui
			>
				<HoverCardTrigger asChild>
					<button
						type="button"
						className="flex items-center gap-2 rounded-lg border px-2.5 py-1 text-sm hover:bg-accent"
						onClick={() => setOpen(!open)}
					>
						<MessageSquare className="size-4 text-muted-foreground" />
						{t("selection.annotationCount", { count: selections.length })}
					</button>
				</HoverCardTrigger>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label={t("common:remove")}
					onClick={() => remove()}
				>
					<X className="size-3.5" />
				</Button>
			</div>
			<HoverCardContent
				side="top"
				align="start"
				className="max-h-80 w-[min(28rem,calc(100vw-2rem))] overflow-y-auto p-1"
				data-annotation-ui
			>
				<ol className="divide-y">
					{selections.map((selection, index) => (
						<li key={selection.id} className="flex gap-2 p-3">
							<span className="text-muted-foreground">{index + 1}.</span>
							<div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm">
								<SelectionSourceButton selection={selection} />
								<p className="mb-1 text-xs text-muted-foreground">
									{t("selection.selectedText")}
								</p>
								<p>{selection.text}</p>
								<p className="mb-1 mt-3 text-xs text-muted-foreground">
									{t("selection.userComment")}
								</p>
								<p>{selection.comment || t("selection.noComment")}</p>
							</div>
							<div className="flex shrink-0 items-start">
								<Button
									type="button"
									size="icon-sm"
									variant="ghost"
									aria-label={t("common:edit")}
									onClick={(event) => {
										const rect = event.currentTarget.getBoundingClientRect();
										setOpen(false);
										openAnnotationEditor(selection, {
											x: rect.left,
											y: rect.top,
										});
									}}
								>
									<Pencil className="size-4" />
								</Button>
								<Button
									type="button"
									size="icon-sm"
									variant="ghost"
									aria-label={t("common:remove")}
									onClick={() => remove(selection.id)}
								>
									<Trash2 className="size-4" />
								</Button>
							</div>
						</li>
					))}
				</ol>
			</HoverCardContent>
		</HoverCard>
	);
}
