import type { PromptImage } from "@/lib/agent/api";
import { loadPdfVisualTraceImage } from "@/lib/pdf/agent-trace/image";
import type { PdfVisualSessionTrace } from "@/lib/pdf/agent-trace/types";

export type PdfVisualTraceThumbnail = PromptImage;

export async function loadPdfVisualTraceThumbnails(
	paperAbsPath: string | null | undefined,
	traces: PdfVisualSessionTrace[],
): Promise<Record<string, PdfVisualTraceThumbnail>> {
	if (!paperAbsPath || traces.length === 0) return {};
	const entries = await Promise.all(
		traces.map(async (trace) => {
			const image = await loadPdfVisualTraceImage(paperAbsPath, trace.image);
			return image ? ([trace.id, image] as const) : null;
		}),
	);
	return Object.fromEntries(entries.filter((entry) => entry !== null));
}
