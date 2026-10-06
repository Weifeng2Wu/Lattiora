import { LayoutDetectionPipeline } from "@embedpdf/ai";
import type {
	PdfDocumentObject,
	PdfEngine,
	PdfPageObject,
} from "@embedpdf/models";
import { getPdfAiRuntime } from "./ai-runtime";
import { ensureLayoutModel } from "./model";
import { paddlePageToRegions } from "./paddle";

/** Run the original PP-DocLayoutV3 weights in browser WASM/WebGPU. */
export async function analyzeBrowserLayoutPage(
	engine: PdfEngine,
	doc: PdfDocumentObject,
	page: PdfPageObject,
	signal?: AbortSignal,
) {
	await ensureLayoutModel(signal);
	signal?.throwIfAborted();
	const scaleFactor = Math.min(
		2,
		2400 / Math.max(page.size.width, page.size.height),
	);
	const blob = await engine
		.renderPageRect(
			doc,
			page,
			{ origin: { x: 0, y: 0 }, size: page.size },
			{
				scaleFactor,
				imageType: "image/png",
				withAnnotations: false,
				withForms: false,
			},
		)
		.toPromise();
	const bitmap = await createImageBitmap(blob);
	try {
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("layoutModelUnavailable");
		ctx.drawImage(bitmap, 0, 0);
		const task = getPdfAiRuntime().run(new LayoutDetectionPipeline(), {
			imageData: ctx.getImageData(0, 0, bitmap.width, bitmap.height),
			sourceWidth: bitmap.width,
			sourceHeight: bitmap.height,
		});
		// Cancellation discards results. ORT may finish its current page in the worker.
		const detections = await task.toPromise();
		signal?.throwIfAborted();
		return paddlePageToRegions({
			page: {
				widthPx: bitmap.width,
				heightPx: bitmap.height,
				boxes: detections.map((d) => ({
					clsId: d.classId,
					label: d.label,
					score: d.score,
					coordinate: d.bbox,
				})),
			},
			pageIndex: page.index,
			pageWidth: page.size.width,
			pageHeight: page.size.height,
			idPrefix: "onnx",
		});
	} finally {
		bitmap.close();
	}
}
