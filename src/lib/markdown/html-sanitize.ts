import DOMPurify, { type Config } from "dompurify";

const SANITIZE_CONFIG: Config = {
	ADD_TAGS: ["iframe"],
	ADD_ATTR: ["align", "allow", "allowfullscreen", "loading", "target"],
	FORBID_TAGS: [
		"base",
		"button",
		"embed",
		"form",
		"input",
		"link",
		"meta",
		"object",
		"script",
		"select",
		"style",
		"textarea",
	],
	FORBID_ATTR: ["formaction", "srcdoc"],
};

const IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-popups";

function isHttpUrl(value: string | null): boolean {
	if (!value) return false;
	try {
		const { protocol } = new URL(value, "https://invalid.local");
		return protocol === "https:" || protocol === "http:";
	} catch {
		return false;
	}
}

/** Remote frames only, always sandboxed, never able to leak the referrer. */
function hardenIframes(root: DocumentFragment): void {
	for (const frame of root.querySelectorAll("iframe")) {
		if (!isHttpUrl(frame.getAttribute("src"))) {
			frame.remove();
			continue;
		}
		frame.setAttribute("sandbox", IFRAME_SANDBOX);
		frame.setAttribute("referrerpolicy", "no-referrer");
		frame.setAttribute("loading", "lazy");
	}
}

function hardenLinks(root: DocumentFragment): void {
	for (const link of root.querySelectorAll("a[href]")) {
		link.setAttribute("target", "_blank");
		link.setAttribute("rel", "noopener noreferrer");
	}
}

/**
 * Render-time sanitizer for verbatim HTML kept in Markdown notes. The Markdown
 * file always holds the author's original source; only what reaches the DOM is
 * narrowed, because the app ships without a CSP.
 */
export function sanitizeEmbeddedHtml(html: string): string {
	if (!html.trim()) return "";
	const template = document.createElement("template");
	template.innerHTML = DOMPurify.sanitize(html, SANITIZE_CONFIG);
	hardenIframes(template.content);
	hardenLinks(template.content);
	return template.innerHTML;
}
