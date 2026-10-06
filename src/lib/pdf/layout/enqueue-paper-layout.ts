/** Original automatic layout entry, executed by the browser rather than native JobCenter. */
import i18n from "@/i18n";
import { cloudLock } from "@/lib/cloud/db";
import { cloudRelative } from "@/lib/cloud/files";
import { errorText } from "@/lib/core/error";
import { logger } from "@/lib/core/logger";
import { runLocalActivity } from "@/lib/core/tasks";
import { analyzePaperLayoutHeadless } from "@/lib/pdf/layout/headless-analyze";
import { readLayoutSidecar } from "@/lib/pdf/layout/io";
import { layoutAnalysisStore } from "@/lib/pdf/layout/store";

const queuedPapers = new Map<string, Promise<void>>();

/** Deduplicate across tabs; recheck the persisted result after acquiring the lock. */
export function enqueuePaperLayoutAnalysis(opts: {
	paperAbsPath: string;
	paperLabel?: string;
}): Promise<void> {
	const paperAbsPath = opts.paperAbsPath
		.replace(/[/\\]+$/, "")
		.replace(/\\/g, "/");
	if (!paperAbsPath) return Promise.resolve();
	const existing = queuedPapers.get(paperAbsPath);
	if (existing) return existing;
	const pending = (async () => {
		try {
			await cloudLock(`layout:${cloudRelative(paperAbsPath)}`, async () => {
				const cached = await readLayoutSidecar(paperAbsPath);
				if (cached?.regions?.length) return;
				await runLocalActivity(
					{
						kind: "layoutRun",
						title: i18n.t("viewer:figures.analyzing"),
						detail: opts.paperLabel || paperAbsPath.split("/").at(-1),
					},
					async (ctx) => {
						const documentId = `headless-layout-${ctx.id}`;
						const unsubscribe = layoutAnalysisStore.subscribe(
							({ ui, activeDocumentId }) => {
								if (activeDocumentId !== documentId || ui.stage !== "running")
									return;
								if (typeof ui.progress === "number")
									ctx.setProgress(ui.progress);
								if (ui.message) ctx.setDetail(ui.message);
							},
						);
						try {
							ctx.signal.throwIfAborted();
							await analyzePaperLayoutHeadless({
								paperAbsPath,
								paperLabel: opts.paperLabel,
								documentId,
								signal: ctx.signal,
							});
						} finally {
							unsubscribe();
						}
					},
					{ concurrency: 1 },
				);
			});
		} catch (error) {
			// runLocalActivity retains the failed/cancelled row in the original task panel.
			logger.warn("browser paper layout analysis failed", {
				paperAbsPath,
				error: errorText(error),
			});
		} finally {
			queuedPapers.delete(paperAbsPath);
		}
	})();
	queuedPapers.set(paperAbsPath, pending);
	return pending;
}
