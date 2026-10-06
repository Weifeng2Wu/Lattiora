import { toVaultRelative } from "@/lib/core/path";
import { vaultStore } from "@/lib/vault/store";
import { agentSessionStore } from "./agent-session-store";
import { annotationRanges } from "./selection-annotations";
import type { SelectionContext } from "./selection-store";

export function findQuoteOffset(
	text: string,
	quote: string,
	anchor?: SelectionContext["textAnchor"],
): number | null {
	const exact = anchor?.exact ?? quote;
	if (!exact) return null;
	const matches: number[] = [];
	for (
		let start = text.indexOf(exact);
		start >= 0;
		start = text.indexOf(exact, start + 1)
	) {
		if (
			anchor &&
			(!text.slice(0, start).endsWith(anchor.prefix) ||
				!text.slice(start + exact.length).startsWith(anchor.suffix))
		)
			continue;
		matches.push(start);
	}
	return matches.length === 1 ? matches[0] : null;
}
export function captureTextAnchor(
	source: HTMLElement,
	range: Range,
): NonNullable<SelectionContext["textAnchor"]> {
	const prefix = range.cloneRange();
	prefix.selectNodeContents(source);
	prefix.setEnd(range.startContainer, range.startOffset);
	const selected = range.toString();
	const start =
		prefix.toString().length + (selected.length - selected.trimStart().length);
	const exact = selected.trim().slice(0, 4000);
	const text = source.textContent ?? "";
	return {
		exact,
		prefix: text.slice(Math.max(0, start - 48), start),
		suffix: text.slice(start + exact.length, start + exact.length + 48),
	};
}
function rangeAt(
	source: HTMLElement,
	start: number,
	length: number,
): Range | null {
	const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
	const range = document.createRange();
	let offset = 0;
	let begun = false;
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const end = offset + (node.textContent?.length ?? 0);
		if (!begun && start < end) {
			range.setStart(node, start - offset);
			begun = true;
		}
		if (begun && start + length <= end) {
			range.setEnd(node, start + length - offset);
			return range;
		}
		offset = end;
	}
	return null;
}
export function resolveSelectionRange(
	selection: SelectionContext,
): Range | null {
	// Selection.toString() follows rendered text; Range.toString() also includes
	// hidden KaTeX markup. Compare DOM anchors with their captured DOM text.
	const live = annotationRanges.get(selection.id);
	const surface = live?.startContainer.parentElement?.closest<HTMLElement>(
		"[data-selection-chat-source]",
	);
	if (
		live?.startContainer.isConnected &&
		surface &&
		surface.dataset.selectionChatOrigin === selection.origin &&
		(selection.origin === "chat"
			? surface.dataset.selectionChatMessage === selection.messageId &&
				matchesChatSource(selection, surface.dataset.selectionChatSource ?? "")
			: toVaultRelative(
					vaultStore.getState().vaultPath,
					surface.dataset.selectionChatSource ?? "",
				) === selection.sourcePath) &&
		live.toString().trim() === (selection.textAnchor?.exact ?? selection.text)
	)
		return live;
	const candidates: Range[] = [];
	for (const source of document.querySelectorAll<HTMLElement>(
		"[data-selection-chat-source]",
	)) {
		if (source.dataset.selectionChatOrigin !== selection.origin) continue;
		if (selection.origin === "chat") {
			if (
				!matchesChatSource(selection, source.dataset.selectionChatSource ?? "")
			)
				continue;
			if (
				!selection.messageId ||
				source.dataset.selectionChatMessage !== selection.messageId
			)
				continue;
		} else if (
			toVaultRelative(
				vaultStore.getState().vaultPath,
				source.dataset.selectionChatSource ?? "",
			) !== selection.sourcePath
		)
			continue;
		const start = findQuoteOffset(
			source.textContent ?? "",
			selection.text,
			selection.textAnchor,
		);
		if (start === null) continue;
		const range = rangeAt(
			source,
			start,
			selection.textAnchor?.exact.length ?? selection.text.length,
		);
		if (range) candidates.push(range);
	}
	if (candidates.length !== 1) return null;
	annotationRanges.set(selection.id, candidates[0]);
	return candidates[0];
}

export function matchesChatSource(
	selection: SelectionContext,
	sourcePath: string,
): boolean {
	if (selection.sourcePath === sourcePath) return true;
	if (!selection.chatSessionId) return false;
	const target = agentSessionStore
		.getState()
		.sessions.find((session) => `Chat ${session.id}` === sourcePath);
	return Boolean(
		target &&
			(target.id === selection.chatSessionId ||
				target.providerSessionId === selection.chatSessionId),
	);
}
