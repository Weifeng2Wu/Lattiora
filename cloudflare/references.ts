import type { CitationMeta } from "../src/lib/cloud/reference-types";
import { HttpError, json, readBytes, readJson } from "./http";

async function requestJson(url: string): Promise<unknown> {
	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(20000),
			redirect: "manual",
			headers: { accept: "application/json" },
		});
		if (!response.ok) {
			await response.body?.cancel();
			throw new HttpError(502, "referencesUnavailable");
		}
		return JSON.parse(
			new TextDecoder().decode(await readBytes(response, 8 * 1024 * 1024)),
		);
	} catch (error) {
		if (error instanceof HttpError) throw error;
		throw new HttpError(502, "referencesUnavailable");
	}
}
export async function referenceRoutes(
	request: Request,
): Promise<Response | null> {
	if (
		new URL(request.url).pathname !== "/api/references" ||
		request.method !== "POST"
	)
		return null;
	const input = (await readJson(request, 4096)) as {
		doi?: string;
		arxivId?: string;
	};
	if (!input || typeof input !== "object")
		throw new HttpError(400, "invalidIdentifier");
	const doi =
		typeof input.doi === "string" && /^10\.\d{4,9}\/\S{1,512}$/.test(input.doi)
			? input.doi
			: undefined;
	const arxiv =
		typeof input.arxivId === "string" &&
		/^(?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7})(?:v\d+)?$/i.test(input.arxivId)
			? input.arxivId
			: undefined;
	if (!doi && !arxiv) throw new HttpError(400, "invalidIdentifier");
	try {
		const citations: CitationMeta[] = [];
		let offset = 0;
		for (let page = 0; page < 5; page++) {
			const id = doi ? `DOI:${doi}` : `ARXIV:${arxiv}`;
			const response = (await requestJson(
				`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(id)}/references?fields=title,authors,year,venue,externalIds,url&limit=1000&offset=${offset}`,
			)) as {
				data?: Array<{
					citedPaper?: {
						title?: string;
						authors?: Array<{ name: string }>;
						year?: number;
						venue?: string;
						externalIds?: { DOI?: string; ArXiv?: string };
						url?: string;
					};
				}>;
				next?: number;
			};
			if (!Array.isArray(response.data))
				throw new Error("invalidProviderResponse");
			for (const { citedPaper: p } of response.data)
				if (p)
					citations.push({
						title: p.title,
						authors: p.authors?.map((a) => a.name),
						year: p.year ?? undefined,
						venue: p.venue,
						doi: p.externalIds?.DOI,
						arxivId: p.externalIds?.ArXiv,
						url: p.url,
					});
			if (response.next == null)
				return citations.length
					? json({ source: "s2", citations })
					: await crossref(doi);
			if (!Number.isInteger(response.next) || response.next <= offset)
				throw new Error("invalidProviderResponse");
			offset = response.next;
		}
		throw new HttpError(413, "referencesTooLarge");
	} catch (error) {
		if (error instanceof HttpError && error.status === 413) throw error;
		return crossref(doi);
	}
}
async function crossref(doi?: string): Promise<Response> {
	if (!doi) throw new HttpError(502, "referencesUnavailable");
	const response = (await requestJson(
		`https://api.crossref.org/works/${encodeURIComponent(doi)}`,
	)) as { message?: { reference?: Array<Record<string, unknown>> } };
	const refs = response.message?.reference;
	if (!Array.isArray(refs)) throw new HttpError(502, "referencesUnavailable");
	if (refs.length > 5000) throw new HttpError(413, "referencesTooLarge");
	const text = (value: unknown) =>
		typeof value === "string" ? value : undefined;
	return json({
		source: "crossref",
		citations: refs.map((r) => ({
			title: text(r["article-title"]),
			authors: typeof r.author === "string" ? [r.author] : [],
			year: /^\d{4}$/.test(String(r.year)) ? Number(r.year) : undefined,
			venue: text(r["journal-title"]),
			doi: text(r.DOI),
			raw: text(r.unstructured),
		})),
	});
}
