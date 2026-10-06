import katex from "katex";

const CACHE_LIMIT = 1000;

const cache = new Map<string, string>();

function makeKey(tex: string, options: katex.KatexOptions): string {
	return [
		tex,
		options.displayMode ? "1" : "0",
		options.output ?? "html",
		String(options.throwOnError ?? false),
		options.errorColor ?? "",
		String(options.strict ?? "ignore"),
		String(options.trust ?? false),
		options.fleqn ? "1" : "0",
		options.leqno ? "1" : "0",
	].join("::");
}

function retain(key: string, html: string): void {
	cache.delete(key);
	cache.set(key, html);
	while (cache.size > CACHE_LIMIT) {
		const oldest = cache.keys().next().value;
		if (typeof oldest !== "string") break;
		cache.delete(oldest);
	}
}

const originalRenderToString = katex.renderToString.bind(katex);

/** Render TeX to HTML, reusing a bounded module-level cache by input + options. */
export function getKatexHtml(tex: string, options: katex.KatexOptions): string {
	const key = makeKey(tex, options);
	const cached = cache.get(key);
	if (cached !== undefined) {
		retain(key, cached);
		return cached;
	}
	const html = originalRenderToString(tex, options);
	retain(key, html);
	return html;
}

/** Render TeX into an existing DOM element using the shared HTML cache. */
export function renderKatexToElement(
	tex: string,
	options: katex.KatexOptions,
	element: HTMLElement,
): void {
	element.innerHTML = getKatexHtml(tex, options);
}

/**
 * Make the cache transparent to third-party KaTeX consumers (e.g. rehype-katex
 * used by Streamdown for Agent messages). The output is identical, so this only
 * removes duplicate work across the app.
 */
katex.renderToString = (tex, options) => getKatexHtml(tex, options ?? {});
