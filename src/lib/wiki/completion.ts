import type { WikiSearchCandidate } from "@/lib/wiki";

export type WikiCompletionRequest =
	| { kind: "file"; query: string }
	| { kind: "heading"; target: string; query: string }
	| { kind: "block"; target: string; query: string }
	| { kind: "annotation"; target: string; query: string }
	| { kind: "alias"; target: string; query: string };

/**
 * Interpret the text after a live `[[` trigger. The caller owns where that
 * text came from; this function keeps the query grammar deterministic and
 * makes it testable without a Slate editor.
 */
export function parseWikiCompletionQuery(
	draft: string,
): WikiCompletionRequest | null {
	if (/[\]\n]/.test(draft)) return null;
	const alias = draft.indexOf("|");
	if (alias >= 0) {
		const target = draft.slice(0, alias).trim();
		// Allow `[[@id|alias]]` / `[[NOTES@id|alias]]` alias completion.
		if (!target && !draft.slice(0, alias).includes("@")) return null;
		return {
			kind: "alias",
			target,
			query: draft.slice(alias + 1),
		};
	}
	const hash = draft.indexOf("#");
	if (hash >= 0) {
		const target = draft.slice(0, hash).trim();
		const fragment = draft.slice(hash + 1);
		if (fragment.startsWith("^")) {
			return { kind: "block", target, query: fragment.slice(1).trim() };
		}
		if (fragment.startsWith("@")) {
			return {
				kind: "annotation",
				target,
				query: fragment.slice(1).trim(),
			};
		}
		return { kind: "heading", target, query: fragment.trim() };
	}
	const at = draft.lastIndexOf("@");
	if (at >= 0) {
		return {
			kind: "annotation",
			target: draft.slice(0, at).trimEnd(),
			query: draft.slice(at + 1).trim(),
		};
	}
	const caret = draft.indexOf("^");
	if (caret >= 0) {
		return {
			kind: "block",
			target: draft.slice(0, caret).trim(),
			query: draft.slice(caret + 1).trim(),
		};
	}
	return { kind: "file", query: draft.trim() };
}

export type WikiCompletionInsert = {
	target: string;
	heading?: string;
	alias?: string;
};

export type WikiCompletionMatch = {
	start: number;
	end: number;
	raw: string;
};

export type WikiCompletionTrigger = {
	start: number;
	raw: string;
	embed: boolean;
};

type WikiArrowKeyEvent = {
	key: string;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
};

export type WikiLinkArrowDirection = "backward" | "forward";

/** Completion accepts the same primary action from keyboard-only workflows. */
export function isWikiCompletionSubmitKey(key: string): key is "Enter" | "Tab" {
	return key === "Enter" || key === "Tab";
}

/**
 * Resolve a plain arrow into the source-entry direction. Vertical arrows use
 * the same boundary semantics as horizontal arrows for block-like embeds.
 * Modified arrows remain native editor/OS selection and navigation commands.
 */
export function wikiLinkArrowDirection(
	event: WikiArrowKeyEvent,
): WikiLinkArrowDirection | null {
	if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
		return null;
	}
	if (event.key === "ArrowLeft" || event.key === "ArrowUp") return "backward";
	if (event.key === "ArrowRight" || event.key === "ArrowDown") return "forward";
	return null;
}

export function isPlainWikiLinkArrowKey(event: WikiArrowKeyEvent): boolean {
	return wikiLinkArrowDirection(event) !== null;
}

/**
 * Locate the active `[[` / `![[` token ending at the caret. The returned start
 * owns the complete syntax prefix, including `!` for an embed, so completion
 * never leaves a detached bang in the document.
 */
export function findWikiCompletionTrigger(
	text: string,
	cursorOffset: number,
): WikiCompletionTrigger | null {
	if (cursorOffset < 0 || cursorOffset > text.length) return null;
	const before = text.slice(0, cursorOffset);
	const bracketsStart = before.lastIndexOf("[[");
	if (bracketsStart < 0) return null;
	const raw = before.slice(bracketsStart + 2);
	if (/[\]\n]/.test(raw)) return null;
	const embed = bracketsStart > 0 && before[bracketsStart - 1] === "!";
	return {
		start: embed ? bracketsStart - 1 : bracketsStart,
		raw,
		embed,
	};
}

/**
 * Locate the live completion token around a Slate caret. A Tab completion
 * leaves `]]` after the caret, so replacement must consume those delimiters as
 * well as the typed prefix or a later Enter leaves duplicate brackets behind.
 */
export function findWikiCompletionMatch(
	text: string,
	cursorOffset: number,
	expectedRaw: string,
	expectedEmbed = false,
): WikiCompletionMatch | null {
	const trigger = findWikiCompletionTrigger(text, cursorOffset);
	if (
		!trigger ||
		trigger.raw !== expectedRaw ||
		trigger.embed !== expectedEmbed
	) {
		return null;
	}
	const end = text.startsWith("]]", cursorOffset)
		? cursorOffset + 2
		: cursorOffset;
	return { start: trigger.start, end, raw: trigger.raw };
}

/** Convert a canonical Host candidate into the persisted `wikiLink` node data. */
export function wikiCompletionInsert(
	candidate: WikiSearchCandidate,
	request?: WikiCompletionRequest | null,
): WikiCompletionInsert {
	if (
		request?.kind === "heading" &&
		candidate.kind === "heading" &&
		candidate.fragment?.kind === "heading" &&
		candidate.fragment.path.length
	) {
		return {
			target: request.target,
			heading: candidate.fragment.path.join("#"),
			alias: candidate.alias,
		};
	}
	if (
		request?.kind === "block" &&
		candidate.kind === "block" &&
		candidate.fragment?.kind === "block"
	) {
		return {
			target: request.target,
			heading: `^${candidate.fragment.id}`,
			alias: candidate.alias,
		};
	}
	if (
		request?.kind === "annotation" &&
		candidate.kind === "annotation" &&
		candidate.fragment?.kind === "annotation"
	) {
		return {
			target: request.target,
			heading: `@${candidate.fragment.id}`,
			alias: candidate.alias,
		};
	}
	const hash = candidate.insertText.indexOf("#");
	const at = candidate.insertText.lastIndexOf("@");
	// Frontmatter-alias hits use `candidate.alias` only for list identity/label.
	// Never write `|display` for file picks so Tab/Enter can continue with # / @.
	const displayAlias = candidate.kind === "file" ? undefined : candidate.alias;
	if (at >= 0 && hash < 0) {
		return {
			target: candidate.insertText.slice(0, at),
			heading: candidate.insertText.slice(at) || undefined,
			alias: displayAlias,
		};
	}
	return {
		target:
			hash < 0 ? candidate.insertText : candidate.insertText.slice(0, hash),
		heading:
			hash < 0 ? undefined : candidate.insertText.slice(hash + 1) || undefined,
		alias: displayAlias,
	};
}

function normalizedCompletionText(value: string): string {
	return value.replace(/\\/g, "/").trim().toLowerCase();
}

/**
 * Once Tab has filled a target, keep only exact target/label matches in the
 * file list. Duplicate basenames intentionally remain visible so the user must
 * choose the Vault-relative path that disambiguates them.
 */
export function narrowExactWikiFileCandidates(
	candidates: WikiSearchCandidate[],
	query: string,
): WikiSearchCandidate[] {
	const key = normalizedCompletionText(query);
	if (!key) return candidates;
	const exactTargets = candidates.filter(
		(candidate) =>
			candidate.kind === "file" &&
			normalizedCompletionText(candidate.insertText) === key,
	);
	if (exactTargets.length) return exactTargets;
	const exactLabels = candidates.filter(
		(candidate) =>
			candidate.kind === "file" &&
			normalizedCompletionText(candidate.label) === key,
	);
	return exactLabels.length ? exactLabels : candidates;
}

export function sameWikiPath(left: string, right: string): boolean {
	return (
		left.replace(/\\/g, "/").toLowerCase() ===
		right.replace(/\\/g, "/").toLowerCase()
	);
}

/**
 * Secondary line under a completion row.
 * File hits (including frontmatter-alias hits) show the vault-relative path only;
 * the primary line already carries the basename or alias label.
 */
export function wikiFileCandidateSecondaryLine(
	candidate: Pick<WikiSearchCandidate, "kind" | "path" | "alias" | "detail">,
): string | undefined {
	if (candidate.kind === "file") {
		const path = candidate.path.trim();
		return path || undefined;
	}
	const detail = candidate.detail?.trim();
	return detail || undefined;
}

/** Stable identity for a selected completion while the editor stays mounted. */
export function wikiCompletionCandidateKey(
	candidate: WikiSearchCandidate,
): string {
	return [
		candidate.kind,
		candidate.path,
		candidate.insertText,
		candidate.alias ?? "",
	].join("\u0000");
}

/** Keep an in-memory MRU list without adding another persisted Vault state. */
export function addRecentWikiCandidate(
	recent: WikiSearchCandidate[],
	candidate: WikiSearchCandidate,
	limit = 8,
): WikiSearchCandidate[] {
	const key = wikiCompletionCandidateKey(candidate);
	return [
		candidate,
		...recent.filter((item) => wikiCompletionCandidateKey(item) !== key),
	].slice(0, limit);
}
