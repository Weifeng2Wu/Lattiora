import { normalizeMarkdownMath } from "@/lib/markdown/math-normalize";

import { linkifyBareUrls, linkifyBareVaultCitations } from "./bare-url-link";
import { stripCitationStatusTags } from "./citation-href";
import { linkifyWikilinks } from "./wikilink-citation";

/**
 * Streamdown ships rehype-harden with `allowedLinkPrefixes: ["*"]`, but harden
 * only treats hrefs starting with `/`, `./`, or `../` as relative. Bare vault
 * paths like `papers/a/a.pdf#page=1` fail parseUrl and render as
 * `label [blocked]` with title `Blocked URL: …`. Prefix `./` so harden keeps
 * them; {@link cleanCitationHref} strips it again on click.
 */
export function prefixVaultMarkdownHrefs(text: string): string {
	return text.replace(
		/\]\(((?:\.\.?\/)*(?:papers|notes)\/[^)\s]+)\)/gi,
		(_full, href: string) => {
			const normalized = href.replace(/^\.\//, "");
			return `](./${normalized})`;
		},
	);
}

/** Prepare agent text consistently before Streamdown renders it. */
export function prepareAgentMessageMarkdown(text: string): string {
	return prefixVaultMarkdownHrefs(
		linkifyBareUrls(
			linkifyBareVaultCitations(
				linkifyWikilinks(stripCitationStatusTags(normalizeMarkdownMath(text))),
			),
		),
	);
}
