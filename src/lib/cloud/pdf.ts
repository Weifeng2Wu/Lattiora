import type { PdfTextRun } from "@embedpdf/models";
import { renderPdfRegionPromptImage } from "@/components/viewer/pdf/region-crop";
import i18n from "@/i18n";
import { getHeadlessPdfEngine } from "@/lib/pdf/layout/headless-analyze";
import {
	writeLayoutIndexFromRaw,
	writeLayoutSidecar,
} from "@/lib/pdf/layout/io";
import { paddlePageToRegions } from "@/lib/pdf/layout/paddle";
import type { ParserBackend } from "@/lib/pdf/layout/settings";
import { enrichCaptionRegionsWithText } from "@/lib/pdf/layout/title-text";
import type { PdfLayoutRegion } from "@/lib/pdf/layout/types";
import { loadSettings } from "@/lib/settings";
import { cloudAiError, ocrCloudImage } from "./ai";
import { listLocalFiles, readLocalFile, writeLocalFile } from "./files";
import { parserOcr, runParserJob } from "./parser";

type ExtractOptions = {
	force?: boolean;
	ocrProvider?: "agentero" | "openaiCompatible";
	allowOcr?: boolean;
	layoutModel?: boolean;
	signal?: AbortSignal;
	onProgress?: (page: number, total: number) => void;
};
export type CloudPdfResult = {
	text: string;
	regions: PdfLayoutRegion[];
	pageCount: number;
	scannedPages: number[];
	assets?: Array<{ path: string; data: Uint8Array<ArrayBuffer> }>;
};

/** Group adjacent PDFium text runs into paragraphs without merging columns. */
export function textRunsToRegions(
	runs: PdfTextRun[],
	pageIndex: number,
	width: number,
	height: number,
): PdfLayoutRegion[] {
	const groups: Array<{
		text: string;
		x: number;
		y: number;
		right: number;
		bottom: number;
		lastY: number;
		lastX: number;
		fontSize: number;
	}> = [];
	for (const run of runs) {
		if (!run.text.trim()) continue;
		const { origin, size } = run.rect;
		const prev = groups.at(-1);
		const sameLine =
			prev && Math.abs(origin.y - prev.lastY) < Math.max(2, run.fontSize * 0.4);
		const nextLine =
			prev &&
			origin.y >= prev.lastY &&
			origin.y - prev.bottom < run.fontSize * 0.8 &&
			Math.abs(origin.x - prev.x) < run.fontSize * 2;
		if (
			prev &&
			(sameLine || nextLine) &&
			Math.abs(prev.fontSize - run.fontSize) < 2 &&
			origin.x >= prev.lastX - width * 0.6
		) {
			prev.text += `${sameLine ? "" : "\n"}${run.text}`;
			prev.x = Math.min(prev.x, origin.x);
			prev.y = Math.min(prev.y, origin.y);
			prev.right = Math.max(prev.right, origin.x + size.width);
			prev.bottom = Math.max(prev.bottom, origin.y + size.height);
			prev.lastY = origin.y;
			prev.lastX = origin.x;
		} else
			groups.push({
				text: run.text,
				x: origin.x,
				y: origin.y,
				right: origin.x + size.width,
				bottom: origin.y + size.height,
				lastY: origin.y,
				lastX: origin.x,
				fontSize: run.fontSize,
			});
	}
	return groups.map((group, index) => {
		const rect = {
			x: Math.max(0, group.x),
			y: Math.max(0, group.y),
			w: Math.max(1, Math.min(width, group.right) - Math.max(0, group.x)),
			h: Math.max(1, Math.min(height, group.bottom) - Math.max(0, group.y)),
		};
		return {
			id: `browser-${pageIndex}-${index}`,
			pageIndex,
			kind: "text",
			label: "text",
			score: 1,
			readingOrder: index,
			text: group.text.trim(),
			rect,
			bbox: {
				x: rect.x / width,
				y: rect.y / height,
				w: rect.w / width,
				h: rect.h / height,
			},
		};
	});
}

export async function extractCloudPdf(
	path: string,
	options: ExtractOptions = {},
): Promise<CloudPdfResult> {
	options.signal?.throwIfAborted();
	const buffer = await (await readLocalFile(path)).arrayBuffer();
	const hash = Array.from(
		new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
	)
		.map((v) => v.toString(16).padStart(2, "0"))
		.join("");
	const engine = await getHeadlessPdfEngine();
	const doc = await engine
		.openDocumentBuffer({
			id: `cloud-parse-${crypto.randomUUID()}`,
			content: buffer,
		})
		.toPromise();
	const regions: PdfLayoutRegion[] = [];
	const pages: string[] = [];
	const scannedPages: number[] = [];
	try {
		for (const page of doc.pages) {
			options.signal?.throwIfAborted();
			options.onProgress?.(page.index + 1, doc.pageCount);
			const runs = (await engine.getPageTextRuns(doc, page).toPromise()).runs;
			let pageRegions = textRunsToRegions(
				runs,
				page.index,
				page.size.width,
				page.size.height,
			);
			let text = pageRegions.map((r) => r.text).join("\n\n");
			if (options.ocrProvider || text.replace(/\s/g, "").length < 12) {
				scannedPages.push(page.index + 1);
				if (options.allowOcr) {
					const configHash = options.ocrProvider
						? await crypto.subtle.digest(
								"SHA-256",
								new TextEncoder().encode(
									JSON.stringify(
										loadSettings().layout.providerConfigs[
											options.ocrProvider
										] ?? {},
									) + options.ocrProvider,
								),
							)
						: null;
					const configId = configHash
						? Array.from(new Uint8Array(configHash), (v) =>
								v.toString(16).padStart(2, "0"),
							).join("")
						: "unified";
					const cachePath = `.agentero/pdf-ocr/${hash}/${configId}-${page.index}.md`;
					try {
						text = options.force
							? ""
							: await (await readLocalFile(cachePath)).text();
					} catch {
						text = "";
					}
					if (!text) {
						const image = await renderPdfRegionPromptImage({
							engine,
							document: doc,
							pageIndex: page.index,
							region: { x: 0, y: 0, w: 1, h: 1 },
							maxEdgePx: 2000,
						});
						text = options.ocrProvider
							? await parserOcr(
									options.ocrProvider,
									image.data,
									image.mimeType,
									options.signal,
								)
							: await ocrCloudImage(
									`data:${image.mimeType};base64,${image.data}`,
									undefined,
									options.signal,
								);
						await writeLocalFile(
							cachePath,
							new Blob([text], { type: "text/markdown" }),
						);
					}
					pageRegions = [
						{
							id: `ocr-${page.index}`,
							pageIndex: page.index,
							kind: "text",
							label: "ocr-page",
							score: 1,
							readingOrder: 0,
							text,
							rect: { x: 0, y: 0, w: page.size.width, h: page.size.height },
							bbox: { x: 0, y: 0, w: 1, h: 1 },
						},
					];
				}
			}
			if (options.layoutModel) {
				const { analyzeBrowserLayoutPage } = await import(
					"@/lib/pdf/layout/browser-analyze"
				);
				pageRegions = enrichCaptionRegionsWithText(
					await analyzeBrowserLayoutPage(engine, doc, page, options.signal),
					page.index,
					runs,
					page.size,
				);
			}
			regions.push(...pageRegions);
			pages.push(`<!-- page ${page.index + 1} -->\n\n${text}`);
		}
		return {
			text: pages.join("\n\n"),
			regions,
			pageCount: doc.pageCount,
			scannedPages,
		};
	} finally {
		await engine.closeDocument(doc).toPromise();
	}
}

async function paperPdf(
	paperPath: string,
): Promise<{ path: string; folder: string }> {
	const rel = paperPath.replace(/^\/cloud\/?/, "");
	const pdf = (await listLocalFiles()).find(
		(file) =>
			!file.deleted &&
			(file.path === rel || file.path.startsWith(`${rel}/`)) &&
			/\.pdf$/i.test(file.path),
	);
	if (!pdf) throw new Error("pdfMissing");
	return {
		path: pdf.path,
		folder: /\.pdf$/i.test(rel) ? rel.replace(/\/[^/]+$/, "") : rel,
	};
}
async function extractConfiguredPdf(
	path: string,
	backend: ParserBackend,
	mode: "layout" | "body",
	options: ExtractOptions,
): Promise<CloudPdfResult> {
	if (backend !== "paddle" && backend !== "mineru")
		return extractCloudPdf(path, {
			...options,
			allowOcr: options.allowOcr ?? mode === "body",
			layoutModel: mode === "layout" && backend === "local",
			ocrProvider: mode === "body" && backend !== "local" ? backend : undefined,
		});
	const result = await runParserJob(path, backend, mode, options);
	options.signal?.throwIfAborted();
	const engine = await getHeadlessPdfEngine();
	const doc = await engine
		.openDocumentBuffer({
			id: `remote-result-${crypto.randomUUID()}`,
			content: await (await readLocalFile(path)).arrayBuffer(),
		})
		.toPromise();
	try {
		if (mode === "layout" && result.pages.length !== doc.pageCount)
			throw new Error("invalidProviderResponse");
		if (mode === "body" && !result.markdown.trim())
			throw new Error("invalidProviderResponse");
		const regions: PdfLayoutRegion[] = [];
		for (const page of doc.pages) {
			const parsed = result.pages[page.index];
			if (!parsed) continue;
			let pageRegions = paddlePageToRegions({
				page: parsed,
				pageIndex: page.index,
				pageWidth: page.size.width,
				pageHeight: page.size.height,
				idPrefix: backend,
			});
			const runs = await engine.getPageTextRuns(doc, page).toPromise();
			pageRegions = enrichCaptionRegionsWithText(
				pageRegions,
				page.index,
				runs.runs,
				page.size,
			);

			regions.push(...pageRegions);
		}
		return {
			text: result.markdown,
			regions,
			pageCount: doc.pageCount,
			scannedPages: [],
			assets: result.assets,
		};
	} finally {
		await engine.closeDocument(doc).toPromise();
	}
}
export async function parseCloudPaper(
	paperPath: string,
	options: ExtractOptions = {},
): Promise<CloudPdfResult> {
	const pdf = await paperPdf(paperPath);
	const backend = loadSettings().layout.backend;
	const result = await extractConfiguredPdf(
		pdf.path,
		backend,
		"layout",
		options,
	);
	options.signal?.throwIfAborted();
	await writeLocalFile(
		`${pdf.folder}/source/parsed.md`,
		new Blob([result.text], { type: "text/markdown" }),
	);
	await writeLayoutSidecar(
		`/cloud/${pdf.folder}`,
		result.regions,
		backend === "local"
			? "embedpdf-layout"
			: backend === "paddle"
				? "paddle-layout"
				: "mineru-layout",
	);
	await writeLayoutIndexFromRaw(`/cloud/${pdf.folder}`, result.regions);
	return result;
}
/** Body output uses the selected parser independently from the layout engine. */
export async function parseCloudPaperBody(
	paperPath: string,
	signal?: AbortSignal,
	force = false,
): Promise<string> {
	const pdf = await paperPdf(paperPath);
	const path = `${pdf.folder}/PAPER.md`;
	const snapshot = new Map(
		(await listLocalFiles()).filter((f) => !f.deleted).map((f) => [f.path, f]),
	);
	const previous = snapshot.get(path)?.localId ?? null;
	try {
		const result = await extractConfiguredPdf(
			pdf.path,
			loadSettings().layout.parserBackend,
			"body",
			{ signal, force },
		);
		signal?.throwIfAborted();
		for (const asset of result.assets ?? []) {
			const path = `${pdf.folder}/${asset.path}`;
			await writeLocalFile(path, new Blob([asset.data]), {
				preserveConflict: true,
				expectedLocalId: snapshot.get(path)?.localId ?? null,
			});
		}
		await writeLocalFile(
			path,
			new Blob([result.text], { type: "text/markdown" }),
			{ expectedLocalId: previous, preserveConflict: true },
		);
		return i18n.t("cloud:pdf.parsed", { pages: result.pageCount });
	} catch (error) {
		if (signal?.aborted) throw error;
		throw new Error(cloudAiError(error));
	}
}
