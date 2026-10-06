import DOMPurify from "dompurify";
import i18n from "@/i18n";
import { COOLPAPERS_BRIDGE } from "./coolpapers-bridge";
import { readLocalFile, writeLocalFile } from "./files";
import { HTML_READER_BRIDGE } from "./html-bridge";
import { cloudFetch } from "./sync";

export type HtmlPage = { url: string; html: string };
export function publicHtmlUrl(raw: string): string {
	const url = new URL(raw);
	if (!/^https?:$/.test(url.protocol) || url.username || url.password)
		throw new Error("invalidEndpoint");
	url.hash = "";
	return url.href;
}
/** Public HTML only; credentials are never forwarded to the upstream website. */
export async function loadHtmlPage(
	raw: string,
	signal?: AbortSignal,
	options: {
		preferCache?: boolean;
		acceptCache?: (page: HtmlPage) => boolean;
		allowPlain?: boolean;
		analysis?: boolean;
	} = {},
): Promise<HtmlPage> {
	const url = publicHtmlUrl(raw);
	const hash = Array.from(
		new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url)),
		),
		(v) => v.toString(16).padStart(2, "0"),
	).join("");
	const cache = `.agentero/web-pages/${hash}.json`;
	if (!navigator.onLine || options.preferCache) {
		try {
			const value = JSON.parse(
				await (await readLocalFile(cache)).text(),
			) as HtmlPage;
			if (
				typeof value.html !== "string" ||
				publicHtmlUrl(value.url) !== value.url
			)
				throw new Error("invalidProviderResponse");
			if (
				navigator.onLine &&
				options.acceptCache &&
				!options.acceptCache(value)
			)
				throw new Error("invalidProviderResponse");
			return value;
		} catch (error) {
			if (!navigator.onLine) throw error;
		}
	}

	const response = await cloudFetch(
		options.analysis ? "/api/coolpapers/analysis" : "/api/feeds/fetch",
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ url }),
			signal,
		},
	);
	const data = (await response.json()) as {
		url: string;
		body: string;
		contentType: string;
	};
	if (
		typeof data.body !== "string" ||
		(!/(?:text\/html|application\/xhtml\+xml)/i.test(data.contentType) &&
			!(options.allowPlain && /^text\/plain/i.test(data.contentType)))
	)
		throw new Error("invalidProviderResponse");
	const page = { url: publicHtmlUrl(data.url), html: data.body };
	signal?.throwIfAborted();
	await writeLocalFile(
		cache,
		new Blob([JSON.stringify(page)], { type: "application/json" }),
	);
	return page;
}
/** Untrusted website code never shares the application's origin or credentials. */
export function htmlReaderDocument(
	page: HtmlPage,
	bridge: "reader" | "coolpapers" = "reader",
): string {
	const clean = DOMPurify.sanitize(page.html, {
		WHOLE_DOCUMENT: true,
		ADD_TAGS: ["link", "style"],
		FORBID_TAGS: ["script", "iframe", "object", "embed", "base", "form"],
		FORBID_ATTR: ["srcdoc"],
	});
	const doc = new DOMParser().parseFromString(clean, "text/html");
	for (const node of doc.querySelectorAll(
		"meta[http-equiv],base,link:not([rel='stylesheet'])",
	))
		node.remove();
	const base = doc.createElement("base");
	base.href = publicHtmlUrl(page.url);
	const nonce = crypto.randomUUID().replaceAll("-", "");
	const csp = doc.createElement("meta");
	csp.httpEquiv = "Content-Security-Policy";
	csp.content = `default-src 'none'; script-src 'nonce-${nonce}'; style-src https: http: 'unsafe-inline'; img-src https: http: data:; font-src https: http: data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri https: http:`;
	doc.head.prepend(csp, base);
	const script = doc.createElement("script");
	script.setAttribute("nonce", nonce);
	script.textContent =
		bridge === "reader" ? HTML_READER_BRIDGE : COOLPAPERS_BRIDGE;
	if (bridge === "coolpapers") {
		doc.documentElement.dataset.importLabel = i18n.t("cloud:plaza.import");
		doc.documentElement.dataset.importPending = i18n.t("cloud:plaza.pending");
		doc.documentElement.dataset.importDone = i18n.t("cloud:plaza.done");
		const style = doc.createElement("style");
		style.textContent =
			".title-import {color:#0a7a5a;cursor:pointer}.title-import[data-state] {color:#888;cursor:default}";
		doc.head.append(style);
	}
	doc.body.append(script);
	return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

/** A normal navigation receives its own CSP; srcdoc would inherit the app CSP. */
export async function cacheHtmlPreview(
	page: HtmlPage,
	signal?: AbortSignal,
	bridge: "reader" | "coolpapers" = "reader",
): Promise<{ url: string; release: () => Promise<boolean> }> {
	signal?.throwIfAborted();
	if (!navigator.serviceWorker.controller) {
		await new Promise<void>((resolve, reject) => {
			const finish = (error?: Error) => {
				clearTimeout(timer);
				navigator.serviceWorker.removeEventListener(
					"controllerchange",
					changed,
				);
				signal?.removeEventListener("abort", aborted);
				error ? reject(error) : resolve();
			};
			const changed = () => {
				if (navigator.serviceWorker.controller) finish();
			};
			const aborted = () => finish(new DOMException("Aborted", "AbortError"));
			const timer = setTimeout(
				() => finish(new Error("offlineNotReady")),
				45000,
			);
			navigator.serviceWorker.addEventListener("controllerchange", changed);
			signal?.addEventListener("abort", aborted, { once: true });
			changed();
		});
	}
	const cache = await caches.open("agentero-html-preview-v1");
	const url = new URL(`/_reader/${crypto.randomUUID()}`, location.origin).href;
	await cache.put(
		url,
		new Response(htmlReaderDocument(page, bridge), {
			headers: {
				"content-type": "text/html;charset=utf-8",
				"content-security-policy":
					"sandbox allow-scripts; frame-ancestors 'self'",
				"x-content-type-options": "nosniff",
				"referrer-policy": "no-referrer",
			},
		}),
	);
	const entries = await cache.keys();
	for (const entry of entries.slice(0, Math.max(0, entries.length - 32)))
		await cache.delete(entry);
	return { url, release: () => cache.delete(url) };
}
