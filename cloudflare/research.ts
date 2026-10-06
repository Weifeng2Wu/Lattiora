import { MAX_FILE_BYTES } from "../src/lib/cloud/protocol";
import { HttpError, json, readBytes } from "./http";

export type ResearchPaper = {
	title: string;
	authors: string[];
	year?: number;
	doi?: string;
	arxiv_id?: string;
	publication?: string;
	abstract?: string;
	pdf_url?: string;
	source_url?: string;
};
function publicUrl(value: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new HttpError(400, "invalidEndpoint");
	}
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		(url.port && url.port !== "443") ||
		!url.hostname.includes(".") ||
		/^[\d.]+$/.test(url.hostname) ||
		url.hostname.includes(":") ||
		/\.(local|localhost|internal)$/.test(url.hostname)
	)
		throw new HttpError(400, "invalidEndpoint");
	return url;
}
async function upstream(value: string): Promise<Response> {
	let url = publicUrl(value);
	for (let count = 0; count < 5; count++) {
		const response = await fetch(url, {
			redirect: "manual",
			signal: AbortSignal.timeout(25_000),
			headers: {
				"user-agent": "Lattiora-Web/1.0 (personal research workspace)",
			},
		});
		if ([301, 302, 303, 307, 308].includes(response.status)) {
			const next = response.headers.get("location");
			await response.body?.cancel();
			if (!next) throw new HttpError(502, "downloadFailed");
			url = publicUrl(new URL(next, url).href);
			continue;
		}
		if (!response.ok) {
			await response.body?.cancel();
			throw new HttpError(502, "downloadFailed");
		}
		return response;
	}
	throw new HttpError(502, "downloadFailed");
}
function plain(value: string): string {
	return value
		.replace(/<[^>]*>/g, " ")
		.replace(
			/&(?:amp|lt|gt|quot|apos);/g,
			(v) =>
				({
					"&amp;": "&",
					"&lt;": "<",
					"&gt;": ">",
					"&quot;": '"',
					"&apos;": "'",
				})[v]!,
		)
		.replace(/\s+/g, " ")
		.trim();
}
type Crossref = {
	title?: string[];
	author?: Array<{ given?: string; family?: string; name?: string }>;
	published?: { "date-parts"?: number[][] };
	DOI?: string;
	"container-title"?: string[];
	abstract?: string;
	URL?: string;
	link?: Array<{ URL: string; "content-type"?: string }>;
};
function crossrefPaper(item: Crossref): ResearchPaper {
	return {
		title: plain(item.title?.[0] ?? ""),
		authors: (item.author ?? []).map(
			(a) => a.name || [a.given, a.family].filter(Boolean).join(" "),
		),
		year: item.published?.["date-parts"]?.[0]?.[0],
		doi: item.DOI,
		publication: item["container-title"]?.[0],
		abstract: item.abstract ? plain(item.abstract) : undefined,
		source_url: item.URL,
		pdf_url: item.link?.find(
			(link) => link["content-type"] === "application/pdf",
		)?.URL,
	};
}

export async function researchRoutes(
	request: Request,
): Promise<Response | null> {
	const url = new URL(request.url);
	if (request.method !== "GET") return null;
	if (url.pathname === "/api/arxiv-source") {
		const id = url.searchParams.get("id") ?? "";
		if (
			!/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i.test(id)
		)
			throw new HttpError(400, "invalidIdentifier");
		const response = await upstream(`https://arxiv.org/src/${id}`);
		const bytes = await readBytes(response, 32 * 1024 * 1024);
		return new Response(bytes, {
			headers: {
				"content-type": "application/octet-stream",
				"content-disposition": "attachment",
				"content-security-policy": "sandbox",
			},
		});
	}
	if (url.pathname === "/api/remote-pdf") {
		const response = await upstream(url.searchParams.get("url") ?? "");
		const bytes = await readBytes(response, MAX_FILE_BYTES);
		if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes("%PDF-"))
			throw new HttpError(422, "invalidPdf");
		return new Response(bytes, {
			headers: {
				"content-type": "application/pdf",
				"content-disposition": "attachment",
				"content-security-policy": "sandbox",
			},
		});
	}
	if (url.pathname !== "/api/lookup") return null;
	const query = url.searchParams.get("q")?.trim();
	if (!query || query.length > 500) throw new HttpError(400, "invalidQuery");
	const id =
		/^(?:(?:https?:\/\/)?(?:www\.)?arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*)?((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?)(?:\.pdf)?$/i.exec(
			query,
		)?.[1];
	if (id) {
		const xml = new TextDecoder().decode(
			await readBytes(
				await upstream(
					`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`,
				),
				1024 * 1024,
			),
		);
		const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1];
		if (!entry || !/<id>https?:\/\/arxiv.org\/abs\//.test(entry))
			throw new HttpError(404, "paperNotFound");
		const tag = (name: string) =>
			plain(
				entry.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ??
					"",
			);
		return json({
			exact: true,
			papers: [
				{
					title: tag("title"),
					authors: [
						...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g),
					].map((match) => plain(match[1])),
					year: Number(tag("published").slice(0, 4)),
					arxiv_id: id,
					doi: tag("arxiv:doi") || undefined,
					abstract: tag("summary"),
					source_url: `https://arxiv.org/abs/${id}`,
					pdf_url: `https://arxiv.org/pdf/${id}`,
				},
			],
		});
	}
	const doi = query.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "");
	const exact = /^10\.\d{4,9}\/\S+$/i.test(doi);
	const endpoint = exact
		? `https://api.crossref.org/works/${encodeURIComponent(doi)}`
		: `https://api.crossref.org/works?query.title=${encodeURIComponent(query)}&rows=6`;
	const raw = JSON.parse(
		new TextDecoder().decode(
			await readBytes(await upstream(endpoint), 2 * 1024 * 1024),
		),
	);
	const papers = (exact ? [raw.message] : raw.message.items)
		.map(crossrefPaper)
		.filter((paper: ResearchPaper) => paper.title && paper.doi);
	return json({ exact, papers });
}
