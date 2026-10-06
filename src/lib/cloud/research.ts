import { notifyError } from "@/lib/core/notify";
import { normalizeArxivId } from "@/lib/paper/arxiv";
import { cloudAiError } from "./ai";
import { type CloudPaper, createCloudPaper, listCloudPapers } from "./catalog";
import { cloudLock } from "./db";
import { DEFAULT_TRANSLATOR_BASE_URL } from "./scholar-defaults";
import { cloudFetch } from "./sync";

export async function lookupCloudPaper(
	query: string,
	signal?: AbortSignal,
): Promise<{ exact: boolean; papers: Partial<CloudPaper>[] }> {
	const { getSettings } = await import("@/lib/settings/react-store");
	const translator = getSettings().translator;
	if (
		translator.enabled !== false &&
		translator.baseUrl &&
		!normalizeArxivId(query) &&
		(translator.baseUrl.replace(/\/+$/, "") !== DEFAULT_TRANSLATOR_BASE_URL ||
			/^(?:https?:\/\/|10\.\d{4,9}\/|(?:ISBN|PMID)\s*:|(?:97[89])?[\d-]{9,17}[\dX]$|\d{1,9}$)/i.test(
				query.trim(),
			))
	)
		return (
			await cloudFetch("/api/translator", {
				method: "POST",
				headers: { "content-type": "application/json" },
				signal,
				body: JSON.stringify({ ...translator, operation: "lookup", query }),
			})
		).json();
	const { isWebPaperQuery, lookupWebPaper } = await import("./web-paper");
	if (isWebPaperQuery(query))
		return { exact: true, papers: [await lookupWebPaper(query, signal)] };
	return (
		await cloudFetch(`/api/lookup?q=${encodeURIComponent(query)}`, { signal })
	).json();
}
export async function importCloudIdentifier(
	query: string,
	parent: string,
	resolved?: Partial<CloudPaper>,
	signal?: AbortSignal,
): Promise<{ paper: CloudPaper; alreadyInLibrary: boolean }> {
	return cloudLock("identifier-import", async () => {
		signal?.throwIfAborted();
		const metadata =
			resolved ?? (await lookupCloudPaper(query, signal)).papers[0];
		if (!metadata?.title) throw new Error("paperNotFound");
		const existing = await listCloudPapers();
		const duplicate = existing.find(
			(paper) =>
				(metadata.doi && paper.doi === metadata.doi) ||
				(metadata.arxiv_id && paper.arxiv_id === metadata.arxiv_id) ||
				(metadata.source_url && paper.source_url === metadata.source_url) ||
				(metadata.meta_source === "translator" &&
					metadata.id &&
					paper.id === metadata.id),
		);
		const { cacheWebPaperBody } = await import("./web-paper");
		if (duplicate) {
			await cacheWebPaperBody(duplicate, signal);
			return { paper: duplicate, alreadyInLibrary: true };
		}
		signal?.throwIfAborted();
		const paper = await createCloudPaper(metadata.title, parent, {
			...metadata,
			type: metadata.type ?? (metadata.arxiv_id ? "arxiv" : "doi"),
		});
		if (paper.pdf_url || paper.arxiv_id) {
			const { downloadCloudAssets } = await import("./paper-assets");
			const result = await downloadCloudAssets(paper.path, signal);
			for (const error of result.errors)
				notifyError(cloudAiError(new Error(error)));
		}
		await cacheWebPaperBody(paper, signal);
		return { paper, alreadyInLibrary: false };
	});
}
