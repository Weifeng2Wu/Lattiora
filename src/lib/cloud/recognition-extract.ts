import type { PdfTextRun } from "@embedpdf/models";
import { getHeadlessPdfEngine } from "@/lib/pdf/layout/headless-analyze";
import type { RecognitionPayload } from "./recognition-protocol";

/** Preserve PDFium run geometry; the service accepts text spans as words. */
export function recognitionPage(
	width: number,
	height: number,
	runs: PdfTextRun[],
): RecognitionPayload["pages"][number] {
	const lines: RecognitionPayload["pages"][number][2][number][number][number][4] =
		[];
	let y = -Infinity;
	for (const run of runs) {
		if (!run.text.trim()) continue;
		const { origin, size } = run.rect;
		if (
			!lines.length ||
			Math.abs(origin.y - y) > Math.max(2, run.fontSize * 0.4)
		)
			lines.push([[]]);
		y = origin.y;
		lines
			.at(-1)?.[0]
			.push([
				origin.x,
				height - origin.y - size.height,
				origin.x + size.width,
				height - origin.y,
				run.fontSize,
				1,
				height - origin.y - size.height,
				0,
				0,
				0,
				0,
				0,
				0,
				run.text,
			]);
	}
	return [width, height, [[[[0, 0, 0, 0, lines]]]]];
}
export async function extractRecognitionPayload(
	blob: Blob,
	fileName: string,
	signal?: AbortSignal,
): Promise<RecognitionPayload> {
	signal?.throwIfAborted();
	const engine = await getHeadlessPdfEngine();
	const doc = await engine
		.openDocumentBuffer({
			id: `recognize-${crypto.randomUUID()}`,
			content: await blob.arrayBuffer(),
		})
		.toPromise();
	try {
		const pages: RecognitionPayload["pages"] = [];
		let characters = 0;
		for (const page of doc.pages.slice(0, 5)) {
			signal?.throwIfAborted();
			const { runs } = await engine.getPageTextRuns(doc, page).toPromise();
			characters += runs.reduce((sum, run) => sum + run.text.trim().length, 0);
			pages.push(recognitionPage(page.size.width, page.size.height, runs));
		}
		if (characters < 12) throw new Error("recognitionNoText");
		const payload = {
			metadata: {},
			totalPages: doc.pageCount,
			fileName,
			pages,
		};
		if (new TextEncoder().encode(JSON.stringify(payload)).length > 1900000)
			throw new Error("tooLarge");
		return payload;
	} finally {
		await engine.closeDocument(doc).toPromise();
	}
}
