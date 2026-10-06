"use client";

import { CornerDownLeftIcon } from "lucide-react";
import type { TElement } from "platejs";
import {
	PlateElement,
	type PlateElementProps,
	useEditorRef,
	useReadOnly,
	useSelected,
} from "platejs/react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/core/utils";
import { sanitizeEmbeddedHtml } from "@/lib/markdown/html-sanitize";

type HtmlBlockElementNode = TElement & { html?: string };

export function HtmlBlockElement(
	props: PlateElementProps<HtmlBlockElementNode>,
) {
	const { t } = useTranslation("editor");
	const editor = useEditorRef();
	const readOnly = useReadOnly();
	const selected = useSelected();
	const [open, setOpen] = React.useState(false);

	const source = props.element.html ?? "";
	const rendered = React.useMemo(() => sanitizeEmbeddedHtml(source), [source]);
	const [draft, setDraft] = React.useState(source);

	React.useEffect(() => {
		if (!open) setDraft(source);
	}, [open, source]);

	const commit = () => {
		setOpen(false);
		const path = editor.api.findPath(props.element);
		if (path && draft !== source)
			editor.tf.setNodes({ html: draft }, { at: path });
	};

	const preview = rendered ? (
		// Sanitized by sanitizeEmbeddedHtml: scripts, styles and event handlers
		// are stripped and iframes are forced into a referrer-less sandbox.
		// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized above
		<div dangerouslySetInnerHTML={{ __html: rendered }} />
	) : (
		<code className="block whitespace-pre-wrap break-all font-mono text-muted-foreground text-xs">
			{source}
		</code>
	);

	if (readOnly) {
		return (
			<PlateElement {...props}>
				<div contentEditable={false}>{preview}</div>
				{props.children}
			</PlateElement>
		);
	}

	return (
		<PlateElement {...props}>
			<Popover open={open} onOpenChange={setOpen} modal={false}>
				<PopoverTrigger asChild>
					<div
						title={t("html.edit")}
						contentEditable={false}
						className={cn(
							"cursor-pointer rounded-sm px-1 py-0.5 hover:bg-primary/5",
							selected && "bg-primary/10",
						)}
					>
						{preview}
					</div>
				</PopoverTrigger>
				<PopoverContent
					className="flex w-(--radix-popover-trigger-width) min-w-80 gap-2"
					onEscapeKeyDown={(event) => event.preventDefault()}
					contentEditable={false}
				>
					<textarea
						// biome-ignore lint/a11y/noAutofocus: matches the equation editor
						autoFocus
						aria-label={t("html.edit")}
						className="agentero-scroll max-h-[50vh] min-h-24 grow resize-none rounded-md border bg-transparent p-2 font-mono text-sm outline-none"
						placeholder={t("html.placeholder")}
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
					/>
					<Button variant="secondary" className="px-3" onClick={commit}>
						<CornerDownLeftIcon className="size-3.5" />
					</Button>
				</PopoverContent>
			</Popover>
			{props.children}
		</PlateElement>
	);
}
