import { normalizeQuoteContext } from "./selection-context";
/**
 * Inline @mention / $skill / /command / selection tokens embedded in composer
 * draft text. Contenteditable renders markers as chips; send path strips
 * mention/skill/selection markers and expands command markers to `/name` for
 * ACP.
 */

import type { SelectionContext } from "@/lib/agent/selection-store";

const MENTION_RE = /\{\{m:([^}]+)\}\}/g;
const SKILL_RE = /\{\{s:([^}]+)\}\}/g;
const COMMAND_RE = /\{\{c:([^}]+)\}\}/g;
const SELECTION_RE = /\{\{sel:([^}]+)\}\}/g;
const ANY_TOKEN_RE = /\{\{(?:m|s|c|sel):[^}]+\}\}/g;

export function encodeMentionToken(path: string): string {
	return `{{m:${encodeURIComponent(path)}}}`;
}

export function encodeSkillToken(skillId: string): string {
	return `{{s:${encodeURIComponent(skillId)}}}`;
}

export function encodeCommandToken(commandName: string): string {
	return `{{c:${encodeURIComponent(commandName)}}}`;
}

function decodePayload(payload: string): string {
	try {
		return decodeURIComponent(payload);
	} catch {
		return payload;
	}
}

export function decodeMentionTokenPayload(payload: string): string {
	return decodePayload(payload);
}

export function decodeSkillTokenPayload(payload: string): string {
	return decodePayload(payload);
}

export function decodeCommandTokenPayload(payload: string): string {
	return decodePayload(payload);
}

function base64UrlEncode(input: string): string {
	const bytes = new TextEncoder().encode(input);
	const binString = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
	return btoa(binString)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function base64UrlDecode(input: string): string {
	const padded =
		input.replace(/-/g, "+").replace(/_/g, "/") +
		"===".slice((input.length + 3) % 4);
	try {
		const binString = atob(padded);
		const bytes = Uint8Array.from(binString, (c) => c.charCodeAt(0));
		return new TextDecoder().decode(bytes);
	} catch {
		return "";
	}
}

export function encodeSelectionToken(selection: SelectionContext): string {
	const json = JSON.stringify(selection);
	return `{{sel:${base64UrlEncode(json)}}}`;
}

export function decodeSelectionTokenPayload(
	payload: string,
): SelectionContext | null {
	const json = base64UrlDecode(payload);
	if (!json) return null;
	try {
		const parsed = JSON.parse(json) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return null;
		const candidate = parsed as Partial<SelectionContext>;
		if (
			typeof candidate.id !== "string" ||
			typeof candidate.text !== "string" ||
			typeof candidate.sourcePath !== "string" ||
			(candidate.origin !== "pdf" &&
				candidate.origin !== "markdown" &&
				candidate.origin !== "chat")
		) {
			return null;
		}
		return {
			id: candidate.id,
			text: candidate.text,
			sourcePath: candidate.sourcePath,
			origin: candidate.origin,
			page: candidate.page,
			lineFrom: candidate.lineFrom,
			lineTo: candidate.lineTo,
			comment:
				typeof candidate.comment === "string" ? candidate.comment : undefined,
			messageId:
				typeof candidate.messageId === "string"
					? candidate.messageId
					: undefined,
			chatSessionId:
				typeof candidate.chatSessionId === "string"
					? candidate.chatSessionId
					: undefined,
			context: candidate.context
				? normalizeQuoteContext(candidate.context)
				: undefined,
			textAnchor:
				candidate.textAnchor &&
				typeof candidate.textAnchor.exact === "string" &&
				typeof candidate.textAnchor.prefix === "string" &&
				typeof candidate.textAnchor.suffix === "string"
					? {
							exact: candidate.textAnchor.exact,
							prefix: candidate.textAnchor.prefix,
							suffix: candidate.textAnchor.suffix,
						}
					: undefined,
			rects: candidate.rects,
			paperAbsPath: candidate.paperAbsPath,
			pinned: candidate.pinned === true,
		};
	} catch {
		return null;
	}
}

/** Paths in document order (duplicates kept once, first wins). */
export function extractMentionPaths(text: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const match of text.matchAll(MENTION_RE)) {
		const path = decodeMentionTokenPayload(match[1] ?? "").trim();
		if (!path || seen.has(path)) continue;
		seen.add(path);
		out.push(path);
	}
	return out;
}

/** Skill ids in document order (duplicates kept once, first wins). */
export function extractSkillIds(text: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const match of text.matchAll(SKILL_RE)) {
		const id = decodeSkillTokenPayload(match[1] ?? "").trim();
		if (!id || seen.has(id)) continue;
		seen.add(id);
		out.push(id);
	}
	return out;
}

/** Selection contexts in document order. */
export function extractSelectionTokens(text: string): SelectionContext[] {
	const out: SelectionContext[] = [];
	for (const match of text.matchAll(SELECTION_RE)) {
		const sel = decodeSelectionTokenPayload(match[1] ?? "");
		if (sel) out.push(sel);
	}
	return out;
}

/** Hide only valid selection tokens in the editor; keep them in the owning chat draft. */
export function withoutSelectionTokens(text: string): string {
	return text.replace(SELECTION_RE, (token, payload: string) =>
		decodeSelectionTokenPayload(payload) ? "" : token,
	);
}
/** Keep annotations in insertion order and before prose so @/$ completion sees the typed suffix. */
export function mergeSelectionDraftInput(draft: string, input: string): string {
	const selections = new Map(
		extractSelectionTokens(draft).map((s) => [s.id, s]),
	);
	for (const selection of extractSelectionTokens(input))
		selections.set(selection.id, selection);
	return (
		Array.from(selections.values(), encodeSelectionToken).join("") +
		withoutSelectionTokens(input)
	);
}
export function updateSelectionToken(
	text: string,
	id: string,
	comment: string | null,
): string {
	return text.replace(SELECTION_RE, (token, payload: string) => {
		const selection = decodeSelectionTokenPayload(payload);
		if (!selection || selection.id !== id) return token;
		return comment === null
			? ""
			: encodeSelectionToken({
					...selection,
					comment: comment.trim() || undefined,
				});
	});
}

/**
 * Draft → send/display body:
 * - mention / skill / selection markers removed (paths, skillIds, selections travel separately)
 * - command markers become `/name` (ACP slash text)
 */
export function stripInlineTokens(text: string): string {
	return text
		.replace(COMMAND_RE, (_m, payload: string) => {
			const name = decodeCommandTokenPayload(payload).trim();
			return name ? `/${name}` : "";
		})
		.replace(/\{\{(?:m|s|sel):[^}]+\}\}/g, "")
		.replace(/\u200B/g, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n[ \t]+/g, "\n")
		.replace(/[ \t]{2,}/g, " ")
		.trim();
}

/**
 * Text used for @ / $ / / trigger detection at the caret end.
 * Markers count as a single "atom" so `$` inside `{{s:…}}` does not open the menu.
 */
export function plainTriggerSuffix(text: string): string {
	return text.replace(ANY_TOKEN_RE, "\uFFFC");
}

/** Replace a trailing `@` / `$` / `/` trigger with an inline token + space. */
export function replaceTrailingTriggerWithToken(
	text: string,
	kind: "mention" | "skill" | "command",
	token: string,
): string {
	const pattern =
		kind === "mention"
			? /(^|\s)@[^\s]*$/
			: kind === "skill"
				? /(^|\s)\$[^\s]*$/
				: /(^|\s)\/[^\s]*$/;
	if (!pattern.test(text)) {
		const needsSpace = text.length > 0 && !/\s$/.test(text);
		return `${text}${needsSpace ? " " : ""}${token} `;
	}
	return text.replace(pattern, (_m, prefix: string) => `${prefix}${token} `);
}

/** Append tokens for paths/skills that are in state but missing from text (legacy drafts). */
export function appendMissingInlineTokens(
	text: string,
	mentionedPaths: string[],
	selectedSkillIds: string[],
): string {
	const havePaths = new Set(extractMentionPaths(text));
	const haveSkills = new Set(extractSkillIds(text));
	let next = text;
	for (const path of mentionedPaths) {
		if (!path || havePaths.has(path)) continue;
		const needsSpace = next.length > 0 && !/\s$/.test(next);
		next = `${next}${needsSpace ? " " : ""}${encodeMentionToken(path)}`;
		havePaths.add(path);
	}
	for (const id of selectedSkillIds) {
		if (!id || haveSkills.has(id)) continue;
		const needsSpace = next.length > 0 && !/\s$/.test(next);
		next = `${next}${needsSpace ? " " : ""}${encodeSkillToken(id)}`;
		haveSkills.add(id);
	}
	if (next !== text && !/\s$/.test(next)) next = `${next} `;
	return next;
}

export type InlineTokenPart =
	| { type: "text"; value: string }
	| { type: "mention"; path: string }
	| { type: "skill"; skillId: string }
	| { type: "command"; name: string }
	| { type: "selection"; selection: SelectionContext };

/** Split draft text into renderable parts (text + chips). */
export function parseInlineTokenParts(text: string): InlineTokenPart[] {
	const parts: InlineTokenPart[] = [];
	const re = /\{\{(m|s|c|sel):([^}]+)\}\}/g;
	let last = 0;
	for (const match of text.matchAll(re)) {
		const index = match.index ?? 0;
		if (index > last) {
			parts.push({ type: "text", value: text.slice(last, index) });
		}
		const kind = match[1];
		const payload = match[2] ?? "";
		if (kind === "m") {
			parts.push({
				type: "mention",
				path: decodeMentionTokenPayload(payload),
			});
		} else if (kind === "s") {
			parts.push({
				type: "skill",
				skillId: decodeSkillTokenPayload(payload),
			});
		} else if (kind === "c") {
			parts.push({
				type: "command",
				name: decodeCommandTokenPayload(payload),
			});
		} else if (kind === "sel") {
			const selection = decodeSelectionTokenPayload(payload);
			if (selection) {
				parts.push({ type: "selection", selection });
			}
		}
		last = index + match[0].length;
	}
	if (last < text.length) {
		parts.push({ type: "text", value: text.slice(last) });
	}
	return parts;
}
