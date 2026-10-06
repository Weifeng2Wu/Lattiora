import { venuePdfUrl } from "./venue-pdf";

const text = (record: Record<string, unknown>, name: string) =>
	typeof record[name] === "string" ? record[name].trim() : undefined;
export const publicZoteroUrl = (value?: string) => {
	try {
		const url = new URL(value ?? "");
		return /^https?:$/.test(url.protocol) && !url.username && !url.password
			? url.href
			: undefined;
	} catch {
		return undefined;
	}
};
/** Original Zotero item fields, including corporate authors and PDF attachments. */
export function mapTranslatorItem(value: unknown, query: string) {
	if (!value || typeof value !== "object") return null;
	const item = value as Record<string, unknown>;
	const title = text(item, "title");
	if (!title) return null;
	const creators = Array.isArray(item.creators) ? item.creators : [];
	const authors = creators.flatMap((value) => {
		if (!value || typeof value !== "object") return [];
		const creator = value as Record<string, unknown>;
		if (
			creator.creatorType &&
			!["author", "editor"].includes(String(creator.creatorType))
		)
			return [];
		const name =
			text(creator, "name") ||
			[text(creator, "firstName"), text(creator, "lastName")]
				.filter(Boolean)
				.join(" ");
		return name ? [name] : [];
	});
	const source = publicZoteroUrl(text(item, "url")) || publicZoteroUrl(query);
	const attachments = Array.isArray(item.attachments) ? item.attachments : [];
	const attachment = attachments.find(
		(value) =>
			value &&
			typeof value === "object" &&
			((value as Record<string, unknown>).mimeType === "application/pdf" ||
				/\.pdf(?:[?#]|$)/i.test(
					String((value as Record<string, unknown>).url),
				)),
	);
	const doi = text(item, "DOI")?.replace(
		/^https?:\/\/(?:dx\.)?doi\.org\//i,
		"",
	);
	const date = text(item, "date");
	const isbn = text(item, "ISBN");
	return {
		title,
		authors,
		doi,
		date,
		id: doi || isbn || text(item, "PMID") || source || query,
		type: doi ? ("doi" as const) : ("other" as const),
		year: date?.match(/\b\d{4}\b/)
			? Number(date.match(/\b\d{4}\b/)?.[0])
			: undefined,
		abstract: text(item, "abstractNote"),
		publication:
			text(item, "publicationTitle") ||
			text(item, "proceedingsTitle") ||
			text(item, "bookTitle"),
		publisher: text(item, "publisher"),
		volume: text(item, "volume"),
		issue: text(item, "issue"),
		pages: text(item, "pages"),
		bibtex_key: text(item, "citationKey"),
		tags: Array.isArray(item.tags)
			? item.tags.flatMap((value) => {
					const name =
						typeof value === "string"
							? value.trim()
							: value && typeof value === "object"
								? text(value as Record<string, unknown>, "tag")
								: undefined;
					return name ? [{ name, color: null }] : [];
				})
			: [],
		html_url: source,
		source_url: source,
		pdf_url:
			publicZoteroUrl(
				attachment
					? text(attachment as Record<string, unknown>, "url")
					: undefined,
			) || venuePdfUrl(source || ""),
		meta_source: "translator",
	};
}
