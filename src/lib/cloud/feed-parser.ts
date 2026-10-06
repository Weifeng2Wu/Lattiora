import DOMPurify from "dompurify";
import { normalizeMarkdownMath } from "@/lib/markdown/math-normalize";

export type ParsedFeedItem = {
	guid: string;
	title: string;
	url: string | null;
	publishedAt: string | null;
	summaryText: string;
	contentHtml: string | null;
	paperUrl: string | null;
};
export type FetchedFeed = {
	url: string;
	status: number;
	contentType: string;
	body: string;
	etag: string | null;
	lastModified: string | null;
};

export function feedLink(
	raw: string | null | undefined,
	base?: string,
): string | null {
	if (!raw?.trim()) return null;
	try {
		const url = new URL(raw.trim(), base);
		return /^https?:$/.test(url.protocol) && !url.username && !url.password
			? url.href
			: null;
	} catch {
		return null;
	}
}
function fragment(html: string) {
	return DOMPurify.sanitize(html, {
		RETURN_DOM_FRAGMENT: true,
		FORBID_TAGS: [
			"script",
			"style",
			"iframe",
			"object",
			"embed",
			"form",
			"input",
			"button",
			"link",
			"meta",
			"base",
		],
	});
}
const plain = (html: string) =>
	fragment(html).textContent?.replace(/\s+/g, " ").trim() ?? "";
const children = (el: Element, name: string) =>
	[...el.children].filter((child) => child.localName === name);
const child = (el: Element, name: string) => children(el, name)[0];
const text = (el: Element | undefined) => el?.textContent?.trim() ?? "";
const date = (raw: string) =>
	Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : null;

export function feedPaperUrl(value: string): string | null {
	const arxiv =
		/(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*)((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?)/i.exec(
			value,
		)?.[1];
	if (arxiv) return `https://arxiv.org/abs/${arxiv.replace(/v\d+$/, "")}`;
	const doi = /(?:doi\.org\/|doi:\s*)(10\.\d{4,9}\/[^\s<>"']+)/i
		.exec(value)?.[1]
		?.replace(/[.,;]+$/, "");
	if (doi) return `https://doi.org/${doi}`;
	const nature = /nature\.com\/articles\/(s\d{5}-\d{3}-\d+-\w|nature\d+)/i.exec(
		value,
	)?.[1];
	return nature ? `https://doi.org/10.1038/${nature}` : null;
}

export function discoverFeed(body: string, base: string): string | null {
	// A detached template keeps external images/scripts from loading during discovery.
	const template = document.createElement("template");
	template.innerHTML = body;
	for (const link of template.content.querySelectorAll(
		'link[rel~="alternate"]',
	)) {
		if (
			/application\/(?:rss\+xml|atom\+xml|feed\+json|json)/i.test(
				link.getAttribute("type") ?? "",
			)
		) {
			const url = feedLink(link.getAttribute("href"), base);
			if (url) return url;
		}
	}
	return null;
}

export function parseFeed(source: FetchedFeed): {
	title: string;
	items: ParsedFeedItem[];
} {
	const items: ParsedFeedItem[] = [];
	let title = "";
	const add = (value: {
		guid: string;
		title: string;
		url?: string | null;
		published?: string;
		summary?: string;
		content?: string;
	}) => {
		const url = feedLink(value.url, source.url);
		const heading = plain(value.title) || url || value.guid;
		if (!heading) return;
		const summary = plain(value.summary || value.content || "");
		items.push({
			guid: value.guid || url || heading,
			title: heading,
			url,
			publishedAt: date(value.published ?? ""),
			summaryText: summary,
			contentHtml: value.content || value.summary || null,
			paperUrl: feedPaperUrl([url, value.guid, heading, summary].join("\n")),
		});
	};
	if (source.body.trimStart().startsWith("{")) {
		let raw: unknown;
		try {
			raw = JSON.parse(source.body);
		} catch {
			throw new Error("feeds.parse");
		}
		if (
			!raw ||
			typeof raw !== "object" ||
			!("version" in raw) ||
			typeof raw.version !== "string" ||
			!raw.version.startsWith("https://jsonfeed.org/version/") ||
			!("items" in raw) ||
			!Array.isArray(raw.items)
		)
			throw new Error("feeds.parse");
		title =
			"title" in raw && typeof raw.title === "string" ? plain(raw.title) : "";
		for (const item of raw.items) {
			if (!item || typeof item !== "object") continue;
			const str = (key: string) =>
				typeof item[key] === "string" ? item[key] : "";
			add({
				guid: str("id"),
				title: str("title"),
				url: str("url") || str("external_url"),
				published: str("date_published") || str("date_modified"),
				summary: str("summary") || str("content_text"),
				content: str("content_html"),
			});
		}
	} else {
		if (/<!DOCTYPE|<!ENTITY/i.test(source.body)) throw new Error("feeds.parse");
		const doc = new DOMParser().parseFromString(source.body, "application/xml");
		if (doc.querySelector("parsererror")) throw new Error("feeds.parse");
		const root = doc.documentElement;
		const atom = root.localName === "feed";
		if (!atom && root.localName !== "rss" && root.localName !== "RDF")
			throw new Error("feeds.parse");
		title = plain(
			text(child(atom ? root : (child(root, "channel") ?? root), "title")),
		);
		for (const el of doc.getElementsByTagNameNS("*", atom ? "entry" : "item")) {
			const link = atom
				? children(el, "link").find(
						(l) =>
							!l.getAttribute("rel") || l.getAttribute("rel") === "alternate",
					)
				: child(el, "link");
			const content = child(el, atom ? "content" : "encoded");
			const summary = child(el, atom ? "summary" : "description");
			const atomContent = (node?: Element) =>
				node?.getAttribute("type") === "xhtml" ? node.innerHTML : text(node);
			add({
				guid: text(child(el, atom ? "id" : "guid")),
				title: text(child(el, "title")),
				url: atom ? link?.getAttribute("href") : text(link),
				published:
					text(child(el, atom ? "published" : "pubDate")) ||
					text(child(el, atom ? "updated" : "date")),
				summary: atomContent(summary),
				content: atomContent(content),
			});
		}
	}
	return {
		title: title || new URL(source.url).hostname,
		items: [...new Map(items.map((item) => [item.guid, item])).values()],
	};
}

/** Preserve headings, lists, links, code and math in the existing Markdown reader. */
export function feedMarkdown(html: string, base: string): string {
	const render = (node: Node): string => {
		if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
		const el = node as Element;
		const content = [...node.childNodes].map(render).join("");
		switch (el.localName) {
			case "br":
				return "\n";
			case "p":
			case "div":
			case "article":
			case "section":
				return `\n\n${content}\n\n`;
			case "h1":
			case "h2":
			case "h3":
			case "h4":
			case "h5":
			case "h6":
				return `\n\n${"#".repeat(Number(el.localName[1]))} ${content.trim()}\n\n`;
			case "strong":
			case "b":
				return `**${content}**`;
			case "em":
			case "i":
				return `*${content}*`;
			case "li":
				return `\n${el.parentElement?.localName === "ol" ? `${[...el.parentElement.children].indexOf(el) + 1}.` : "-"} ${content.trim()}\n`;
			case "blockquote":
				return `\n\n${content
					.trim()
					.split("\n")
					.map((line) => `> ${line}`)
					.join("\n")}\n\n`;
			case "pre": {
				const raw = node.textContent ?? "";
				const fence = "`".repeat(
					Math.max(
						3,
						...[...raw.matchAll(/`+/g)].map((match) => match[0].length + 1),
					),
				);
				return `\n\n${fence}\n${raw}\n${fence}\n\n`;
			}
			case "code": {
				const fence = "`".repeat(
					Math.max(
						1,
						...[...content.matchAll(/`+/g)].map((match) => match[0].length + 1),
					),
				);
				return `${fence} ${content} ${fence}`;
			}
			case "table": {
				const rows = [...el.querySelectorAll("tr")].map((row) =>
					[...row.children]
						.filter((cell) => /^(td|th)$/.test(cell.localName))
						.map((cell) =>
							[...cell.childNodes]
								.map(render)
								.join("")
								.trim()
								.replace(/\|/g, "\\|")
								.replace(/\n/g, "<br>"),
						),
				);
				const width = Math.max(0, ...rows.map((row) => row.length));
				if (!width) return content;
				if (!el.querySelector("tr th")) rows.unshift(Array(width).fill(""));
				rows.splice(1, 0, Array(width).fill("---"));
				return `\n\n${rows.map((row) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`).join("\n")}\n\n`;
			}
			case "a": {
				const url = feedLink(el.getAttribute("href"), base);
				return url ? `[${content}](<${url.replace(/>/g, "%3E")}>)` : content;
			}
			case "img": {
				const url = feedLink(el.getAttribute("src"), base);
				return url
					? `![${el.getAttribute("alt") ?? ""}](<${url.replace(/>/g, "%3E")}>)`
					: "";
			}
			case "tr":
				return `\n${content}\n`;
			case "td":
			case "th":
				return `${content}\t`;
			default:
				return content;
		}
	};
	return normalizeMarkdownMath(
		render(fragment(html))
			.replace(/\n[ \t]+/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim(),
	);
}

export function feedArticle(html: string, url: string) {
	const template = document.createElement("template");
	template.innerHTML = html;
	const root = template.content;
	const doi = [...root.querySelectorAll("meta")]
		.find((el) =>
			/^(citation_doi|prism\.doi|dc\.identifier)$/i.test(
				el.getAttribute("name") ?? el.getAttribute("property") ?? "",
			),
		)
		?.getAttribute("content");
	for (const el of root.querySelectorAll(
		"nav, header, footer, aside, script, style, form",
	))
		el.remove();
	const main = root.querySelector(
		"article, main, [role=main], .entry-content, .post-content",
	);
	if (!main) throw new Error("feeds.body");
	return {
		bodyMarkdown: feedMarkdown(main.innerHTML, url),
		paperUrl: doi ? feedPaperUrl(`doi:${doi.replace(/^doi:\s*/i, "")}`) : null,
	};
}
