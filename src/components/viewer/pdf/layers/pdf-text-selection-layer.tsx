import { useDocumentState } from "@embedpdf/core/react";
import type { Rect } from "@embedpdf/models";
import {
	useSelectionCapability,
	useSelectionPlugin,
} from "@embedpdf/plugin-selection/react";
import { memo, useEffect, useMemo, useState } from "react";
import { buildTightSelectionRects } from "@/lib/pdf/selection-appearance";

export type PdfTextSelectionLayerProps = {
	documentId: string;
	pageIndex: number;
	background: string;
};

/**
 * Zotero-like PDF text selection. Selection behavior stays owned by EmbedPDF;
 * only the visual rectangles are rebuilt from PDFium's tight glyph bounds.
 */
export const PdfTextSelectionLayer = memo(function PdfTextSelectionLayer({
	documentId,
	pageIndex,
	background,
}: PdfTextSelectionLayerProps) {
	const { plugin } = useSelectionPlugin();
	const { provides } = useSelectionCapability();
	const documentState = useDocumentState(documentId);
	const [rects, setRects] = useState<Rect[]>([]);
	const scale = useMemo(
		() => documentState?.scale ?? 1,
		[documentState?.scale],
	);

	useEffect(() => {
		if (!plugin || !provides) return;

		return plugin.registerSelectionOnPage({
			documentId,
			pageIndex,
			onRectsChange: ({ rects: sourceRects }) => {
				if (sourceRects.length === 0) {
					setRects([]);
					return;
				}

				const state = provides.forDocument(documentId).getState();
				setRects(
					buildTightSelectionRects(
						state.geometry[pageIndex],
						state.selection,
						pageIndex,
					),
				);
			},
		});
	}, [documentId, pageIndex, plugin, provides]);

	if (rects.length === 0) return null;

	return (
		<div
			aria-hidden="true"
			style={{
				position: "absolute",
				inset: 0,
				isolation: "isolate",
				mixBlendMode: "multiply",
				pointerEvents: "none",
			}}
		>
			{rects.map((rect) => (
				<div
					key={`${rect.origin.x}:${rect.origin.y}:${rect.size.width}:${rect.size.height}`}
					style={{
						position: "absolute",
						left: rect.origin.x * scale,
						top: rect.origin.y * scale,
						width: rect.size.width * scale,
						height: rect.size.height * scale,
						background,
						borderRadius: 1,
					}}
				/>
			))}
		</div>
	);
});
