import { type CloudPaper, createCloudPaper, listCloudPapers } from "./catalog";
import { cloudLock } from "./db";
import { loadHtmlPage } from "./html-reader";
import { downloadCloudAssets } from "./paper-assets";
import { venuePdfUrl } from "./venue-pdf";

export function coolPaperUrl(branch: string, id: string): string {
	if (!/^[a-zA-Z0-9]+$/.test(branch) || !id.trim() || id.length > 600)
		throw new Error("invalidRequest");
	return `https://papers.cool/${branch}/${encodeURIComponent(id.trim())}`;
}
/** Original Highwire fields, parsed as inert HTML rather than executing the page. */
export function coolPaperMetadata(
	html: string,
	sourceUrl: string,
): Partial<CloudPaper> & { title: string } {
	const doc = new DOMParser().parseFromString(html, "text/html");
	const value = (name: string) =>
		doc
			.querySelector(`meta[name="citation_${name}"]`)
			?.getAttribute("content")
			?.trim() || undefined;
	const title = value("title");
	if (!title) throw new Error("paperNotFound");
	const safeUrl = (raw: string | undefined) => {
		if (!raw) return undefined;
		try {
			const url = new URL(raw, sourceUrl);
			return /^https?:$/.test(url.protocol) && !url.username && !url.password
				? url.href
				: undefined;
		} catch {
			return undefined;
		}
	};
	const date = value("date") || value("year");
	return {
		title,
		authors: (value("authors") || "")
			.split(";")
			.map((s) => s.trim())
			.filter(Boolean),
		abstract: value("abstract"),
		pdf_url:
			safeUrl(value("pdf_url")) ||
			venuePdfUrl(safeUrl(value("public_url")) || ""),
		html_url: safeUrl(value("public_url")),
		source_url: sourceUrl,
		publisher: value("publisher"),
		date,
		year: date ? Number.parseInt(date, 10) || undefined : undefined,
		doi: value("doi"),
		meta_source: "papers.cool",
	};
}
export async function importCoolPaper(
	branch: string,
	id: string,
	parent: string,
	signal?: AbortSignal,
) {
	const url = coolPaperUrl(branch, id);
	return cloudLock("coolpapers-import", async () => {
		signal?.throwIfAborted();
		const page = await loadHtmlPage(url, signal);
		const metadata = coolPaperMetadata(page.html, url);
		const existing = (await listCloudPapers()).find(
			(p) =>
				p.source_url === url ||
				(metadata.doi && p.doi?.toLowerCase() === metadata.doi.toLowerCase()),
		);
		if (existing)
			return {
				paper: existing,
				alreadyInLibrary: true,
				hasPdf: existing.has_pdf,
				errors: [] as string[],
			};
		signal?.throwIfAborted();
		const paper = await createCloudPaper(metadata.title, parent, {
			...metadata,
			id,
			type: "other",
		});
		const assets = await downloadCloudAssets(paper.path, signal);
		return {
			paper,
			alreadyInLibrary: false,
			hasPdf: assets.pdf,
			errors: assets.errors,
		};
	});
}
