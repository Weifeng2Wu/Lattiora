import { z } from "zod";
import { HttpError, json, readBytes, readJson } from "./http";

const inputSchema = z.object({
	url: z.string().max(4096),
	etag: z.string().max(1024).nullable().optional(),
	lastModified: z.string().max(1024).nullable().optional(),
});

/** No credentials or private network targets cross the browser/Worker boundary. */
export function feedUrl(raw: string, base?: string): URL {
	let url: URL;
	try {
		url = new URL(raw, base);
	} catch {
		throw new HttpError(400, "feeds.invalid_url");
	}
	if (
		!/^https?:$/.test(url.protocol) ||
		url.username ||
		url.password ||
		(url.port && url.port !== "443" && url.port !== "80") ||
		!url.hostname.includes(".") ||
		/^[\d.]+$/.test(url.hostname) ||
		url.hostname.includes(":") ||
		/\.(local|localhost|internal)$/.test(url.hostname)
	)
		throw new HttpError(400, "feeds.invalid_url");
	url.hash = "";
	return url;
}

export async function feedRoutes(request: Request): Promise<Response | null> {
	const path = new URL(request.url).pathname;
	const recommendation = path === "/api/recommend/feed";
	const analysis = path === "/api/coolpapers/analysis";
	if (
		(!recommendation && !analysis && path !== "/api/feeds/fetch") ||
		request.method !== "POST"
	)
		return null;
	const raw = await readJson(request, 8192);
	const category = recommendation
		? z
				.object({
					category: z
						.string()
						.regex(/^[a-z][a-z0-9-]*(?:\.[A-Za-z0-9-]+)?$/)
						.max(40),
				})
				.safeParse(raw)
		: null;
	if (category && !category.success)
		throw new HttpError(400, "feeds.invalid_url");
	const parsed = inputSchema.safeParse(
		category?.success
			? { url: `https://rss.arxiv.org/rss/${category.data.category}` }
			: raw,
	);
	if (!parsed.success) throw new HttpError(400, "feeds.invalid_url");
	const { etag, lastModified } = parsed.data;
	if ([etag, lastModified].some((v) => v && /[\r\n]/.test(v)))
		throw new HttpError(400, "feeds.invalid_url");
	let url = feedUrl(parsed.data.url);
	if (
		analysis &&
		(url.origin !== "https://papers.cool" ||
			!/^\/(?:arxiv|venue)\/kimi$/.test(url.pathname) ||
			!url.searchParams.get("paper") ||
			(url.searchParams.get("paper")?.length ?? 0) > 600 ||
			[...url.searchParams.keys()].some((key) => key !== "paper"))
	)
		throw new HttpError(400, "feeds.invalid_url");
	const initialOrigin = url.origin;
	const signal = AbortSignal.any([
		request.signal,
		AbortSignal.timeout(analysis ? 180_000 : 20_000),
	]);
	try {
		for (let i = 0; i < 5; i++) {
			const headers = new Headers({
				accept:
					"application/atom+xml, application/rss+xml, application/feed+json, text/html;q=0.8, */*;q=0.5",
			});
			if (url.origin === initialOrigin) {
				if (etag) headers.set("if-none-match", etag);
				if (lastModified) headers.set("if-modified-since", lastModified);
			}
			const response = await fetch(url, {
				headers,
				signal,
				redirect: "manual",
			});
			if ([301, 302, 303, 307, 308].includes(response.status)) {
				const location = response.headers.get("location");
				await response.body?.cancel();
				if (!location) throw new HttpError(502, "feeds.http");
				url = feedUrl(location, url.href);
				continue;
			}
			if (response.status !== 304 && !response.ok) {
				await response.body?.cancel();
				throw new HttpError(502, "feeds.http");
			}
			const bytes = await readBytes(
				response,
				(recommendation ? 16 : 2) * 1024 * 1024,
			);
			const contentType = response.headers.get("content-type") ?? "";
			const charset =
				/charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? "utf-8";
			let body: string;
			try {
				body = new TextDecoder(charset).decode(bytes);
			} catch {
				body = new TextDecoder().decode(bytes);
			}
			return json({
				url: url.href,
				status: response.status,
				contentType,
				body,
				etag: response.headers.get("etag"),
				lastModified: response.headers.get("last-modified"),
			});
		}
		throw new HttpError(502, "feeds.http");
	} catch (error) {
		if (error instanceof HttpError) {
			if (error.status === 413) throw new HttpError(413, "feeds.too_large");
			throw error;
		}
		throw new HttpError(502, "feeds.fetch");
	}
}
