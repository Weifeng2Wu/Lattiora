/**
 * Convert Obsidian-style `[[wikilink]]` citations in agent markdown into
 * `[label](href)` so Streamdown + AgentCitationLink can render pills.
 *
 * Skips embeds (`![[…]]`), inline/fenced code, and targets that do not look
 * like vault paths (no `/` and no known file extension).
 */

const KNOWN_FILE_EXT =
	/\.(md|mdx|markdown|tex|ltx|pdf|json|bib|csv|png|jpe?g|webp|gif|svg)$/i;
const NOTE_BASENAME = /^(NOTES|PAPER|README)$/i;

/** Last path segment, ignoring a trailing `#fragment`. */
function pathBasename(target: string): string {
	const noFrag = target.split("#", 1)[0] ?? target;
	const parts = noFrag.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? noFrag;
}

function looksLikeVaultWikiTarget(target: string): boolean {
	const t = target.trim();
	if (!t || t.includes("://")) return false;
	if (t.includes("/")) return true;
	return KNOWN_FILE_EXT.test(pathBasename(t));
}

/**
 * Prefer a real file href for common note basenames written without `.md`
 * (`…/NOTES` → `…/NOTES.md`). Paper folder paths stay unchanged.
 */
export function normalizeWikiCitationHref(target: string): string {
	const hash = target.indexOf("#");
	const path = (hash >= 0 ? target.slice(0, hash) : target).replace(/\\/g, "/");
	const frag = hash >= 0 ? target.slice(hash) : "";
	const base = pathBasename(path);
	if (!KNOWN_FILE_EXT.test(base) && NOTE_BASENAME.test(base)) {
		return `${path}.md${frag}`;
	}
	return `${path}${frag}`;
}

function defaultLabel(target: string, alias: string | undefined): string {
	if (alias?.trim()) return alias.trim();
	const base = pathBasename(target.split("#", 1)[0] ?? target);
	return base.replace(/\.(md|mdx|markdown)$/i, "") || base;
}

/**
 * Parse `target` / `target|alias` / `target#frag|alias` wiki body.
 * Returns null when empty.
 */
export function parseWikiCitationBody(
	body: string,
): { target: string; alias?: string } | null {
	const raw = body.trim();
	if (!raw) return null;
	// Alias is the first unescaped `|` (Obsidian).
	let pipe = -1;
	for (let i = 0; i < raw.length; i++) {
		if (raw[i] === "|" && raw[i - 1] !== "\\") {
			pipe = i;
			break;
		}
	}
	const target = (pipe >= 0 ? raw.slice(0, pipe) : raw).trim();
	const alias = pipe >= 0 ? raw.slice(pipe + 1).trim() : undefined;
	if (!target) return null;
	return { target, alias: alias || undefined };
}

/**
 * Replace eligible `[[…]]` with markdown links. Leaves `![[embeds]]` alone.
 */
export function linkifyWikilinks(text: string): string {
	let out = "";
	let i = 0;
	let inFence = false;

	while (i < text.length) {
		// Toggle fenced code on ``` / ~~~ at line starts (best-effort).
		if (
			(text.startsWith("```", i) || text.startsWith("~~~", i)) &&
			(i === 0 || text[i - 1] === "\n")
		) {
			const lineEnd = text.indexOf("\n", i);
			const end = lineEnd >= 0 ? lineEnd + 1 : text.length;
			out += text.slice(i, end);
			i = end;
			inFence = !inFence;
			continue;
		}

		if (inFence) {
			out += text[i];
			i += 1;
			continue;
		}

		// Skip inline code spans.
		if (text[i] === "`") {
			const close = text.indexOf("`", i + 1);
			if (close < 0) {
				out += text.slice(i);
				break;
			}
			out += text.slice(i, close + 1);
			i = close + 1;
			continue;
		}

		// Embeds stay as-is.
		if (text.startsWith("![[", i)) {
			const close = text.indexOf("]]", i + 3);
			if (close < 0) {
				out += text.slice(i);
				break;
			}
			out += text.slice(i, close + 2);
			i = close + 2;
			continue;
		}

		if (text.startsWith("[[", i)) {
			const close = text.indexOf("]]", i + 2);
			if (close < 0) {
				out += text.slice(i);
				break;
			}
			const body = text.slice(i + 2, close);
			const parsed = parseWikiCitationBody(body);
			if (parsed && looksLikeVaultWikiTarget(parsed.target)) {
				const href = normalizeWikiCitationHref(parsed.target);
				const label = defaultLabel(parsed.target, parsed.alias);
				// Escape bare brackets in label so Streamdown keeps one link.
				const safeLabel = label.replace(/[[\]]/g, "");
				out += `[${safeLabel}](${href})`;
				i = close + 2;
				continue;
			}
			out += text.slice(i, close + 2);
			i = close + 2;
			continue;
		}

		out += text[i];
		i += 1;
	}

	return out;
}
