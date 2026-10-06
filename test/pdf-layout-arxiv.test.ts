/**
 * Opt-in real PDF smoke test, without a browser or extra dependencies:
 * AGENTERO_LAYOUT_PDF_DIR=/tmp/agentero-bbox-validation \
 * AGENTERO_LAYOUT_MODEL=/path/to/pp-doclayoutv3.onnx \
 * node node_modules/vitest/vitest.mjs run test/pdf-layout-arxiv.test.ts
 * Inputs: <name>.pdf per AGENTERO_LAYOUT_PDFS (default resnet,vit).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	LayoutDetectionPipeline,
	type OnnxOutputs,
	type OnnxSession,
	type PipelineContext,
} from "@embedpdf/ai";
import { PdfiumNative } from "@embedpdf/engines/pdfium";
import { NoopLogger } from "@embedpdf/models";
import { init } from "@embedpdf/pdfium";
import * as ort from "onnxruntime-web";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dedupeLayoutRegions } from "@/lib/pdf/layout/dedupe";
import {
	bboxFullyContains,
	mergeCaptionsIntoHosts,
} from "@/lib/pdf/layout/merge-captions";
import { pageLayoutToRegions } from "@/lib/pdf/layout/normalize";
import { enrichCaptionRegionsWithText } from "@/lib/pdf/layout/title-text";
import type { PdfLayoutRegion } from "@/lib/pdf/layout/types";
import { layoutPng } from "./helpers/layout-png";

const directory = process.env.AGENTERO_LAYOUT_PDF_DIR;
const model = process.env.AGENTERO_LAYOUT_MODEL;
describe.skipIf(!directory || !model)("arXiv PDF layout smoke", () => {
	let pdf: PdfiumNative;
	let session: ort.InferenceSession;
	const pipeline = new LayoutDetectionPipeline();
	const context: PipelineContext = {
		backend: "wasm",
		logger: new NoopLogger(),
	};
	let adapter: OnnxSession;
	beforeAll(async () => {
		pdf = new PdfiumNative(
			await init({
				wasmBinary: readFileSync(
					fileURLToPath(import.meta.resolve("@embedpdf/pdfium/pdfium.wasm")),
				),
			}),
			{ fontFallback: null },
		);
		ort.env.wasm.numThreads = 1;
		session = await ort.InferenceSession.create(readFileSync(model ?? ""), {
			executionProviders: ["wasm"],
		});
		adapter = {
			inputNames: [...session.inputNames],
			outputNames: [...session.outputNames],
			release: () => session.release(),
			run: async (feeds) => {
				const tensors = Object.fromEntries(
					Object.entries(feeds).map(([key, value]) => [
						key,
						new ort.Tensor(value.type, value.data, value.dims),
					]),
				);
				return (await session.run(tensors)) as unknown as OnnxOutputs;
			},
		};
	}, 120_000);
	afterAll(async () => {
		await session?.release();
		await pdf?.destroy().toPromise();
	});
	it.each(
		(process.env.AGENTERO_LAYOUT_PDFS ?? "resnet,vit").split(","),
	)("renders and analyzes every page of %s", async (name) => {
		const root = directory ?? "";
		const bytes = readFileSync(join(root, `${name}.pdf`));
		const doc = await pdf
			.openDocumentBuffer({
				id: name,
				content: bytes.buffer.slice(
					bytes.byteOffset,
					bytes.byteOffset + bytes.byteLength,
				),
			})
			.toPromise();
		const raw: PdfLayoutRegion[] = [];
		const pages = [];
		try {
			for (const page of doc.pages) {
				const image = await pdf
					.renderPageRaw(doc, page, { scaleFactor: 2 })
					.toPromise();
				const feeds = pipeline.preprocess(
					{
						imageData: image,
						sourceWidth: image.width,
						sourceHeight: image.height,
					},
					adapter,
					context,
				);
				const detections = pipeline.postprocess(
					await adapter.run(feeds),
					context,
				);
				const regions = pageLayoutToRegions({
					pageIndex: page.index,
					pageSize: page.size,
					imageSize: { width: image.width, height: image.height },
					tableStructures: new Map(),
					blocks: detections.map((d) => ({
						id: `${page.index}-${d.id}`,
						classId: d.classId,
						label: d.label,
						score: d.score,
						readingOrder: d.readingOrder,
						imageBbox: d.bbox,
						rect: {
							origin: {
								x: (d.bbox[0] * page.size.width) / image.width,
								y: (d.bbox[1] * page.size.height) / image.height,
							},
							size: {
								width:
									((d.bbox[2] - d.bbox[0]) * page.size.width) / image.width,
								height:
									((d.bbox[3] - d.bbox[1]) * page.size.height) / image.height,
							},
						},
					})),
				});
				const { runs } = await pdf.getPageTextRuns(doc, page).toPromise();
				const enriched = enrichCaptionRegionsWithText(
					regions,
					page.index,
					runs,
					page.size,
				);
				raw.push(...enriched);
				const figures = dedupeLayoutRegions(
					mergeCaptionsIntoHosts(enriched),
				).filter((r) => r.kind === "image" || r.kind === "chart");
				for (const r of figures) {
					expect(r.titleBbox).toBeDefined();
					if (r.titleBbox)
						expect(bboxFullyContains(r.bbox, r.titleBbox)).toBe(true);
					expect(r.bbox.w).toBeGreaterThan(0);
					expect(r.bbox.h).toBeGreaterThan(0);
				}
				writeFileSync(
					join(root, `${name}-${page.index + 1}-pdfium.png`),
					layoutPng(image),
				);
				writeFileSync(
					join(root, `${name}-${page.index + 1}-after.png`),
					layoutPng(image, figures),
				);
				writeFileSync(join(root, `${name}-${page.index + 1}.rgba`), image.data);
				pages.push({
					pageIndex: page.index,
					width: page.size.width,
					height: page.size.height,
					imageWidth: image.width,
					imageHeight: image.height,
					runs,
					detections: detections.map((d) => [d.classId, d.score, ...d.bbox]),
				});
				console.log(
					`${name} page ${page.index + 1}/${doc.pages.length}: ${detections.length} raw, ${figures.length} figures`,
				);
			}
			writeFileSync(
				join(root, `${name}-detections.json`),
				JSON.stringify(pages),
			);
			const figures = dedupeLayoutRegions(mergeCaptionsIntoHosts(raw)).filter(
				(r) => r.kind === "image" || r.kind === "chart",
			);
			writeFileSync(
				join(root, `${name}-after.json`),
				JSON.stringify({ raw, figures }, null, 2),
			);
			expect(figures.length).toBeGreaterThan(0);
		} finally {
			await pdf.closeDocument(doc).toPromise();
		}
	}, 600_000);
});
