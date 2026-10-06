import type {
	DocumentAnalysisProgress,
	DocumentLayout,
	LayoutAnalysisErrorReason,
	LayoutAnalysisScope,
} from "@embedpdf/plugin-layout-analysis";

import i18n from "@/i18n";
import { cloudAiError } from "@/lib/cloud/ai";
import {
	readLayoutSidecar,
	writeLayoutIndexFromRaw,
} from "@/lib/pdf/layout/io";
import { mergeCaptionsIntoHosts } from "@/lib/pdf/layout/merge-captions";
import {
	buildLayoutDocumentResult,
	summarizeLayoutResult,
} from "@/lib/pdf/layout/normalize";
import {
	setLayoutAnalysisUi,
	setLayoutDocumentResult,
} from "@/lib/pdf/layout/store";
import { enrichCaptionRegionsWithText } from "@/lib/pdf/layout/title-text";
import type {
	PdfLayoutDocumentResult,
	PdfLayoutRegion,
} from "@/lib/pdf/layout/types";

export type RunLayoutAnalysisOptions = {
	/**
	 * When true, ignore `source/layout.json` and re-run PP-DocLayoutV3 (PDF→JSON).
	 * When false (default), load the sidecar if present and only re-run
	 * merge/filter into the sidebar store (JSON→regions).
	 */
	force?: boolean;
	/** Paper folder path; when present, raw layout persists to source/layout.json. */
	paperAbsPath?: string | null;
	/** PDF page count for progress bar before the first page-complete event. */
	totalPages?: number | null;
	/** Label shown in progress UI instead of the generic "Analyzing layout…". */
	paperLabel?: string;
	/** Optional live document guard for viewer-bound analysis. */
	isDocumentOpen?: () => boolean;
	/**
	 * True PDF page size in points for remote backends (the service renders
	 * pages itself, so sizes cannot come from a local render).
	 */
	pageSizeAt?: (pageIndex: number) => { width: number; height: number } | null;
	onProgress?: (messageStage: DocumentAnalysisProgress) => void;
	onDone?: (summary: string, total: number) => void;
	onError?: (message: string, aborted: boolean) => void;
};

/** Structural task shape shared by the local plugin task and the remote task. */
export type LayoutTaskLike = {
	onProgress: (listener: (p: DocumentAnalysisProgress) => void) => void;
	wait: (
		ok: (value: DocumentLayout) => void,
		err: (e: { type?: string; reason?: unknown }) => void,
	) => void;
	abort: (reason: LayoutAnalysisErrorReason) => void;
};

class LayoutDocumentClosedError extends Error {
	constructor() {
		super("document closed");
		this.name = "LayoutDocumentClosedError";
	}
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	if (!error || typeof error !== "object") return "";
	const record = error as Record<string, unknown>;
	if (typeof record.message === "string") return record.message;
	const reason = record.reason;
	if (typeof reason === "string") return reason;
	if (reason && typeof reason === "object") {
		const reasonMessage = (reason as Record<string, unknown>).message;
		if (typeof reasonMessage === "string") return reasonMessage;
	}
	return "";
}

function isPdfDocumentCloseRaceError(error: unknown): boolean {
	return /document (does not|is not|not) open/i.test(errorMessage(error));
}

function isLayoutDocumentClosedError(error: unknown): boolean {
	return (
		error instanceof LayoutDocumentClosedError ||
		isPdfDocumentCloseRaceError(error)
	);
}

function assertDocumentOpen(isDocumentOpen?: () => boolean): void {
	if (isDocumentOpen && !isDocumentOpen()) {
		throw new LayoutDocumentClosedError();
	}
}

function taskToPromise<T>(task: {
	wait: (ok: (v: T) => void, err: (e: unknown) => void) => void;
}): Promise<T> {
	return new Promise((resolve, reject) => {
		task.wait(resolve, reject);
	});
}

function buildResultFromRawRegions(
	documentId: string,
	rawRegions: PdfLayoutRegion[],
): PdfLayoutDocumentResult {
	return buildLayoutDocumentResult(
		documentId,
		mergeCaptionsIntoHosts(rawRegions),
		rawRegions,
	);
}

/** Prefer plugin page layout; else recover size from point-rect / normalized bbox. */
function estimatePageSizesFromRegions(
	regions: readonly PdfLayoutRegion[],
	scope: LayoutAnalysisScope,
	isDocumentOpen?: () => boolean,
): Map<number, { width: number; height: number }> {
	const pageSizes = new Map<number, { width: number; height: number }>();
	const pages = new Set(regions.map((r) => r.pageIndex));
	for (const pageIndex of pages) {
		assertDocumentOpen(isDocumentOpen);
		const layout = scope.getPageLayout(pageIndex);
		const size = layout?.pageSize;
		if (size && size.width > 0 && size.height > 0) {
			pageSizes.set(pageIndex, size);
			continue;
		}
		// rect (points) / bbox (0–1) ⇒ page size.
		let width = 0;
		let height = 0;
		for (const r of regions) {
			if (r.pageIndex !== pageIndex) continue;
			if (r.bbox.w > 0.02) width = Math.max(width, r.rect.w / r.bbox.w);
			if (r.bbox.h > 0.02) height = Math.max(height, r.rect.h / r.bbox.h);
		}
		if (width > 0 && height > 0) pageSizes.set(pageIndex, { width, height });
	}
	return pageSizes;
}

/** Pull PDF text layer into caption / body / abstract fields per page. */
async function enrichRawRegionsWithPageText(
	scope: LayoutAnalysisScope,
	raw: PdfLayoutRegion[],
	pageSizes: Map<number, { width: number; height: number }>,
	isDocumentOpen?: () => boolean,
): Promise<PdfLayoutRegion[]> {
	let next = raw;
	const pages = new Set(raw.map((r) => r.pageIndex));
	for (const pageIndex of pages) {
		assertDocumentOpen(isDocumentOpen);
		const pageSize = pageSizes.get(pageIndex);
		if (!pageSize || pageSize.width <= 0 || pageSize.height <= 0) continue;
		try {
			const textRuns = await taskToPromise(scope.getPageTextRuns(pageIndex));
			assertDocumentOpen(isDocumentOpen);
			const runs = textRuns.runs ?? [];
			next = enrichCaptionRegionsWithText(next, pageIndex, runs, pageSize);
		} catch (error) {
			if (
				isLayoutDocumentClosedError(error) ||
				(isDocumentOpen && !isDocumentOpen())
			) {
				throw new LayoutDocumentClosedError();
			}
			// continue without text for this page
		}
	}
	return next;
}

/**
 * Shared analyze-all-pages runner for toolbar + PdfViewerHandle + figures panel.
 * Awaits Host XDG model ensure (ModelScope → HuggingFace) before analysis.
 */
export async function runDocumentLayoutAnalysis(
	scope: LayoutAnalysisScope,
	documentId: string,
	options: RunLayoutAnalysisOptions = {},
): Promise<LayoutTaskLike | null> {
	/** Attribute progress to this paper so the open Figures rail can match. */
	const paperKey = options.paperAbsPath ?? null;
	const setUi = (
		ui: Parameters<typeof setLayoutAnalysisUi>[0],
		withPaper = false,
	) => {
		setLayoutAnalysisUi(ui, documentId, withPaper ? paperKey : undefined);
	};

	const cancelClosedDocument = () => {
		setUi({ stage: "cancelled" });
		options.onError?.("document closed", true);
	};
	if (options.isDocumentOpen && !options.isDocumentOpen()) {
		cancelClosedDocument();
		return null;
	}

	// Default path: JSON→sidebar re-merge from layout.json (no ONNX).
	// `force` skips this and re-runs PDF→JSON via PP-DocLayoutV3.
	if (!options.force && options.paperAbsPath) {
		setUi(
			{
				stage: "running",
				message: "Rebuilding from cached layout…",
				progress: null,
			},
			true,
		);
		const cached = await readLayoutSidecar(options.paperAbsPath);
		if (options.isDocumentOpen && !options.isDocumentOpen()) {
			cancelClosedDocument();
			return null;
		}
		if (cached) {
			try {
				// Sidecar may predate body-text extract; re-pull PDF text layer cheaply.
				const pageSizes = estimatePageSizesFromRegions(
					cached.regions,
					scope,
					options.isDocumentOpen,
				);
				const needsText = cached.regions.some(
					(r) =>
						(r.kind === "text" ||
							r.kind === "abstract" ||
							r.kind === "header" ||
							r.kind === "figure_title") &&
						!(r.text?.trim() || r.title?.trim()),
				);
				const raw = needsText
					? await enrichRawRegionsWithPageText(
							scope,
							cached.regions,
							pageSizes,
							options.isDocumentOpen,
						)
					: cached.regions;
				if (options.isDocumentOpen && !options.isDocumentOpen()) {
					cancelClosedDocument();
					return null;
				}
				// Always re-run merge/filter so algorithm tweaks apply without ONNX.
				const result = buildResultFromRawRegions(documentId, raw);
				setLayoutDocumentResult(result);
				const summary = summarizeLayoutResult(result);
				setUi({
					stage: "done",
					message: summary,
					total: result.regions.length,
				});
				console.info("[layout-analysis]", {
					documentId,
					summary,
					cache: true,
					regions: result.regions,
				});
				// Cache hit stays read-only: text is enriched in memory above, but the
				// viewer never rewrites layout.json (that is the headless writer's job;
				// writing here raced it — §8.2). The index write is a no-op when the
				// content is unchanged.
				void writeLayoutIndexFromRaw(options.paperAbsPath, raw).catch(
					() => undefined,
				);
				options.onDone?.(summary, result.regions.length);
				return null;
			} catch (error) {
				if (
					isLayoutDocumentClosedError(error) ||
					(options.isDocumentOpen && !options.isDocumentOpen())
				) {
					cancelClosedDocument();
					return null;
				}
				throw error;
			}
		}
	}

	{
		const task = new RemoteLayoutTask();
		const abort = new AbortController();
		const originalAbort = task.abort.bind(task);
		task.abort = (reason) => {
			abort.abort();
			originalAbort(reason);
			setUi({ stage: "cancelled" });
			options.onError?.("cancelled", true);
		};
		void (async () => {
			try {
				if (!options.paperAbsPath) throw new Error("pdfMissing");
				const { parseCloudPaper } = await import("@/lib/cloud/pdf");
				const parsed = await parseCloudPaper(options.paperAbsPath, {
					signal: abort.signal,
					force: options.force,
					onProgress: (page, total) => {
						if (!total) {
							setUi({
								stage: "running",
								message: i18n.t("cloud:parser.waiting"),
							});
							return;
						}
						if (options.isDocumentOpen && !options.isDocumentOpen()) {
							abort.abort();
							return;
						}
						setUi(
							{
								stage: "running",
								message: i18n.t("cloud:pdf.parsing", { page, total }),
								progress: Math.round(((page - 1) / total) * 100),
								page,
								total,
								completed: page - 1,
							},
							true,
						);
					},
				});
				abort.signal.throwIfAborted();
				const result = buildResultFromRawRegions(documentId, parsed.regions);
				setLayoutDocumentResult(result);
				const summary = i18n.t("cloud:pdf.parsed", { pages: parsed.pageCount });
				setUi({
					stage: "done",
					message: summary,
					total: parsed.regions.length,
				});
				options.onDone?.(summary, parsed.regions.length);
				task.settle();
			} catch (error) {
				if (abort.signal.aborted) {
					setUi({ stage: "cancelled" });
					options.onError?.("cancelled", true);
					task.settle({ type: "abort" });
					return;
				}
				const message = cloudAiError(error);
				setUi({ stage: "error", message });
				options.onError?.(message, false);
				task.settle({ type: "error", reason: message });
			}
		})();
		return task;
	}
}

/** Minimal LayoutTask-compatible handle for a remote provider run. */
class RemoteLayoutTask implements LayoutTaskLike {
	private progressListeners: Array<(p: DocumentAnalysisProgress) => void> = [];
	private settled = false;
	private aborted = false;

	onProgress(listener: (p: DocumentAnalysisProgress) => void): void {
		this.progressListeners.push(listener);
	}

	wait(
		ok: (value: DocumentLayout) => void,
		err: (e: { type?: string; reason?: unknown }) => void,
	): void {
		this.onSettle = (e) => {
			if (e === "ok") ok({ pages: [] });
			else err(e);
		};
		if (this.settled && this.settleError) {
			this.onSettle(this.settleError);
		} else if (this.settled) {
			this.onSettle("ok");
		}
	}

	abort(reason: LayoutAnalysisErrorReason): void {
		if (this.settled) return;
		this.aborted = true;
		this.settle({ type: "abort", reason });
	}

	get isAborted(): boolean {
		return this.aborted;
	}

	private onSettle:
		| ((e: "ok" | { type?: string; reason?: unknown }) => void)
		| null = null;
	private settleError: { type?: string; reason?: unknown } | null = null;

	emit(p: DocumentAnalysisProgress): void {
		for (const listener of this.progressListeners) listener(p);
	}

	settle(error?: { type?: string; reason?: unknown }): void {
		if (this.settled) return;
		this.settled = true;
		this.settleError = error ?? null;
		if (this.onSettle) this.onSettle(error ?? "ok");
	}
}
