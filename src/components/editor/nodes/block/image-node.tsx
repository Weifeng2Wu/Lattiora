"use client";

import type { TImageElement } from "platejs";
import {
	PlateElement,
	type PlateElementProps,
	useFocused,
	useSelected,
} from "platejs/react";
import { useEffect, useState } from "react";

import { useImageGroup } from "@/components/editor/context/image-group-context";
import { useMarkdownDoc } from "@/components/editor/context/markdown-doc-context";
import { useMarkdownExportMode } from "@/components/editor/markdown-export-mode-context";
import { cn } from "@/lib/core/utils";
import {
	formatMarkdownImageSyntax,
	isRemoteOrInlineImageUrl,
	resolveMarkdownImageAbs,
} from "@/lib/markdown/image";
import { localImageToViewerSource, revokePdfViewerSource } from "@/lib/paper";
import { imageMimeFromPath } from "@/lib/workspace/viewer";

export function ImageElement(props: PlateElementProps<TImageElement>) {
	const url = props.element.url ?? "";
	const alt = (props.element as { alt?: string }).alt ?? "";
	const { filePath } = useMarkdownDoc();
	const exportMode = useMarkdownExportMode();
	const imageGroup = useImageGroup();
	const selected = useSelected();
	const focused = useFocused();
	const active = selected && focused;
	const [src, setSrc] = useState<string>(() =>
		url && isRemoteOrInlineImageUrl(url) ? url : "",
	);

	useEffect(() => {
		let cancelled = false;
		let blobUrl: string | null = null;

		async function load() {
			if (!url) {
				setSrc("");
				return;
			}
			if (isRemoteOrInlineImageUrl(url)) {
				setSrc(url);
				return;
			}
			if (!filePath) {
				setSrc("");
				return;
			}
			const abs = resolveMarkdownImageAbs(filePath, url);
			if (!abs) {
				setSrc("");
				return;
			}
			const mime = imageMimeFromPath(abs);
			const resolved = await localImageToViewerSource(abs, mime);
			if (cancelled) {
				if (resolved) revokePdfViewerSource(resolved);
				return;
			}
			blobUrl = resolved;
			setSrc(resolved ?? "");
		}

		void load();
		return () => {
			cancelled = true;
			if (blobUrl) revokePdfViewerSource(blobUrl);
		};
	}, [url, filePath]);

	const sourceText = formatMarkdownImageSyntax(alt, url);

	return (
		<PlateElement
			{...props}
			className={cn(imageGroup ? null : "py-2", active && "rounded-sm")}
			data-selected={active ? "true" : undefined}
		>
			{/*
			 * Keep the bitmap mounted when selected. Replacing it with source-only
			 * UI made cut/copy feel like editing text, unmounted the <img>, and
			 * conflicted with void-node selection. Show a selection ring + caption
			 * instead so the image stays visible.
			 */}
			<figure
				className="m-0"
				contentEditable={false}
				data-export-pending={url && !src ? "true" : undefined}
			>
				{src ? (
					<img
						src={src}
						alt={alt}
						className={cn(
							// 组内由 item 的 aspect-ratio 定形,图片铺满格子等高显示。
							imageGroup
								? "h-full w-full rounded-sm object-contain"
								: "max-w-full rounded-sm",
							active &&
								"ring-2 ring-default-ring ring-offset-2 ring-offset-background",
						)}
						loading={exportMode ? "eager" : "lazy"}
						draggable={false}
						onLoad={(event) => {
							const img = event.currentTarget;
							if (imageGroup && img.naturalWidth > 0 && img.naturalHeight > 0) {
								imageGroup.reportRatio(
									url,
									img.naturalWidth / img.naturalHeight,
								);
							}
						}}
					/>
				) : url ? (
					<div
						className={cn(
							"rounded-sm border border-dashed border-border px-3 py-6 text-center text-muted-foreground text-sm",
							active &&
								"ring-2 ring-default-ring ring-offset-2 ring-offset-background",
						)}
					>
						{url}
					</div>
				) : null}
				{active ? (
					<figcaption className="mt-1 break-all font-mono text-caption text-muted-foreground leading-snug">
						{sourceText}
					</figcaption>
				) : null}
			</figure>
			{props.children}
		</PlateElement>
	);
}
