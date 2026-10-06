import { Readability } from "@mozilla/readability";
import DOMPurify from "dompurify";
import TurndownService from "turndown";
import type { CloudPaper } from "./catalog";
import { listLocalFiles, writeLocalFile } from "./files";
import { loadHtmlPage, publicHtmlUrl } from "./html-reader";
import { venuePdfUrl } from "./venue-pdf";

export function isWebPaperQuery(query: string): boolean {
	try {
		const url = new URL(query);
		return (
			/^https?:$/.test(url.protocol) &&
			!/^(?:www\.)?arxiv\.org$/i.test(url.hostname) &&
			!/^(?:dx\.)?doi\.org$/i.test(url.hostname)
		);
	} catch {
		return false;
	}
}

/** Inert browser parsing replaces the desktop web translator for public article pages. */
export function extractWebPaper(html: string, source: string) {
	const url = publicHtmlUrl(source);
	const doc = new DOMParser().parseFromString(html, "text/html");
	for (const old of doc.querySelectorAll("base")) old.remove();
	const base = doc.createElement("base");
	base.href = url;
	doc.head.prepend(base);
	// Readability resolves against documentURI (the app URL for DOMParser documents).
	// Resolve attributes against the actual source before handing it the document.
	for (const node of doc.querySelectorAll("a[href],img[src]")) {
		const attribute = node.tagName === "A" ? "href" : "src";
		try {
			node.setAttribute(
				attribute,
				publicHtmlUrl(new URL(node.getAttribute(attribute) || "", url).href),
			);
		} catch {
			node.removeAttribute(attribute);
		}
	}
	const metas = [...doc.querySelectorAll("meta")];
	const values = (name: string) =>
		metas
			.filter(
				(node) =>
					(
						node.getAttribute("name") ||
						node.getAttribute("property") ||
						""
					).toLowerCase() === name,
			)
			.map((node) => node.getAttribute("content")?.trim() || "")
			.filter(Boolean);
	const value = (...names: string[]) =>
		names.map((name) => values(name)[0]).find(Boolean);
	const article = new Readability(doc.cloneNode(true) as Document).parse();
	const title =
		value("citation_title", "og:title", "twitter:title") ||
		article?.title ||
		doc.title.trim();
	if (!title) throw new Error("paperNotFound");
	const safeUrl = (raw: string | undefined) => {
		if (!raw) return undefined;
		try {
			return publicHtmlUrl(new URL(raw, url).href);
		} catch {
			return undefined;
		}
	};
	const authorTags = values("citation_author");
	const author =
		value("citation_authors", "author", "article:author") || article?.byline;
	const date = value(
		"citation_publication_date",
		"citation_date",
		"article:published_time",
		"date",
	);
	const doi = value("citation_doi", "dc.identifier")?.replace(
		/^https?:\/\/(?:dx\.)?doi\.org\//i,
		"",
	);
	const metadata: Partial<CloudPaper> & { title: string } = {
		title,
		type: doi?.startsWith("10.") ? "doi" : "html",
		authors: authorTags.length
			? authorTags
			: author
				? author.split(/\s*;\s*/).filter(Boolean)
				: [],
		abstract:
			value("citation_abstract", "description", "og:description") ||
			article?.excerpt ||
			undefined,
		source_url: url,
		html_url: url,
		pdf_url: safeUrl(value("citation_pdf_url")) || venuePdfUrl(url),
		doi: doi?.startsWith("10.") ? doi : undefined,
		date,
		year: date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : undefined,
		publication: value(
			"citation_journal_title",
			"citation_conference_title",
			"og:site_name",
		),
		publisher: value("citation_publisher"),
		meta_source: "web",
	};
	const clean = new DOMParser().parseFromString(
		DOMPurify.sanitize(
			article?.content ||
				doc.querySelector("article,main")?.innerHTML ||
				doc.body.innerHTML,
			{
				FORBID_TAGS: [
					"script",
					"style",
					"iframe",
					"object",
					"form",
					"nav",
					"footer",
					"header",
				],
			},
		),
		"text/html",
	);
	for (const el of clean.querySelectorAll("a[href],img[src]")) {
		const attr = el.tagName === "A" ? "href" : "src";
		const resolved = safeUrl(el.getAttribute(attr) || undefined);
		if (resolved) el.setAttribute(attr, resolved);
		else el.removeAttribute(attr);
	}
	const converter = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
	});
	converter.keep((node) =>
		["table", "math"].includes(node.nodeName.toLowerCase()),
	);
	const markdown = converter.turndown(clean.body.innerHTML).trim();
	return { metadata, markdown };
}

export async function lookupWebPaper(query: string, signal?: AbortSignal) {
	const page = await loadHtmlPage(query, signal);
	return extractWebPaper(page.html, page.url).metadata;
}
/** Keep authored body files; cache source HTML and extracted text for reading and Agent tools. */
export async function cacheWebPaperBody(
	paper: CloudPaper,
	signal?: AbortSignal,
): Promise<void> {
	if (paper.meta_source !== "web" || !paper.source_url) return;
	const path = `${paper.path}/PAPER.md`;
	if ((await listLocalFiles()).some((file) => file.path === path)) return;
	const page = await loadHtmlPage(paper.source_url, signal, {
		preferCache: true,
	});
	const { markdown } = extractWebPaper(page.html, page.url);
	if (!markdown) throw new Error("invalidProviderResponse");
	await writeLocalFile(
		path,
		new Blob([`# ${paper.title}\n\n> ${page.url}\n\n${markdown}\n`], {
			type: "text/markdown",
		}),
		{ expectedText: null },
	);
}
