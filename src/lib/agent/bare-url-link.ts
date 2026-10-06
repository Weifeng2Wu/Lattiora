/**
 * Convert bare http(s) URLs in markdown prose into `[domain](url)` inline links.
 *
 * Skips URLs that are already inside Markdown links `[]()` or inside backticks,
 * so agent-written citations and code are not double-wrapped.
 */
export function linkifyBareUrls(text: string): string {
	const urlPattern =
		/https?:\/\/[a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[-a-zA-Z0-9]+)+(?:\/[^`\s)\]>]*)?/g;

	// Walk through the string and only replace URLs that are not inside a
	// markdown link or inline code.
	let out = "";
	let lastIndex = 0;
	let match: RegExpExecArray | null = urlPattern.exec(text);
	const inLinkPattern = /\]\([^)]*$/; // text preceding `](...`
	const inCodePattern = /`[^`]*$/; // inside backticks

	while (match !== null) {
		const url = match[0];
		const start = match.index;
		const prefix = text.slice(0, start);
		const insideLink = inLinkPattern.test(prefix);
		const insideCode = inCodePattern.test(prefix);

		if (insideLink || insideCode) {
			out += text.slice(lastIndex, start + url.length);
			lastIndex = start + url.length;
		} else {
			out += text.slice(lastIndex, start);
			const host = new URL(url).hostname.replace(/^www\./, "");
			out += `[${host}](${url})`;
			lastIndex = start + url.length;
		}

		match = urlPattern.exec(text);
	}
	out += text.slice(lastIndex);
	return out;
}

/**
 * Convert bare vault citation paths into Markdown links so they reach the
 * shared citation-pill renderer. These paths commonly occur in agent prose as
 * `Figure 1 (papers/.../paper.pdf#figure=1)`.
 *
 * Only file paths with a supported citation fragment are linked: ordinary
 * relative paths should remain prose, while a citation always has an
 * unambiguous navigation target. As above, existing Markdown links and code
 * spans are left intact.
 */
export function linkifyBareVaultCitations(text: string): string {
	const citationPattern =
		/(^|[("'\s])(papers\/(?:[^\s()[\]`<>,;:!?]+\/)*[^\s()[\]`<>,;:!?]+\.(?:pdf|tex|ltx|md|mdx|markdown)#(?:page|section|figure|table|algorithm|formula|region)=[^\s()[\]`<>,;:!?]+)/gi;

	let out = "";
	let lastIndex = 0;
	let match: RegExpExecArray | null = citationPattern.exec(text);
	const inLinkPattern = /\]\([^)]*$/;
	const inCodePattern = /`[^`]*$/;

	while (match !== null) {
		const prefix = match[1] ?? "";
		const href = match[2] ?? "";
		const hrefStart = match.index + prefix.length;
		const preceding = text.slice(0, hrefStart);

		if (inLinkPattern.test(preceding) || inCodePattern.test(preceding)) {
			out += text.slice(lastIndex, hrefStart + href.length);
			lastIndex = hrefStart + href.length;
		} else {
			out += text.slice(lastIndex, hrefStart);
			// `./` so Streamdown rehype-harden keeps vault-relative hrefs.
			out += `[${citationLabel(href)}](./${href})`;
			lastIndex = hrefStart + href.length;
		}

		match = citationPattern.exec(text);
	}

	out += text.slice(lastIndex);
	return out;
}

function citationLabel(href: string): string {
	const [path, fragment = ""] = href.split("#", 2);
	const base = path?.split("/").filter(Boolean).pop() || href;
	const [key, value] = fragment.split("=", 2);
	if (key === "page" && value) return `${base} · p.${value}`;
	return value ? `${base} · ${key}=${value}` : base;
}
