/**
 * Ephemeral selection-ask prompt for text surfaces (plaza feed detail,
 * proxied web papers, plain-text editor selections).
 * Parallel to PDF ask (`buildPdfAskPrompt`) but without page geometry.
 */

import type { PdfAskThread } from "@/lib/pdf/ask/types";

/**
 * Build a single-turn prompt for a text-surface selection ask (plaza feed
 * detail, proxied web papers, plain-text editor selections).
 */
export function buildPlazaAskPrompt(
	thread: PdfAskThread,
	latestUserQuestion: string,
	opts?: {
		title?: string;
		url?: string | null;
		surface?: "feed" | "web" | "text";
		/** Vault file path (`surface: "text"`). */
		path?: string | null;
	},
): string {
	const quote = thread.anchor.quote?.trim();
	const history = thread.messages
		.filter((m) => m.role === "user" || m.role === "assistant")
		.slice(0, -1)
		.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
		.join("\n\n");

	const parts = [
		opts?.surface === "web"
			? "You are helping the user read a web page in Lattiora."
			: opts?.surface === "text"
				? "You are helping the user with a file in Lattiora."
				: "You are helping the user read a research feed item in Lattiora.",
	];
	const title = opts?.title?.trim();
	if (title) {
		parts.push(`${opts?.surface === "text" ? "File" : "Item title"}: ${title}`);
	}
	const path = opts?.path?.trim();
	if (path) parts.push(`File path: ${path}`);
	const url = opts?.url?.trim();
	if (url) parts.push(`Item URL: ${url}`);
	if (quote) {
		parts.push(
			opts?.surface === "text"
				? "Quoted text from the file:"
				: "Quoted text from the item:",
			`> ${quote}`,
		);
	}
	if (history) {
		parts.push("Earlier turns in this selection thread:", history);
	}
	const q = latestUserQuestion.trim();
	parts.push(
		"User question:",
		q || "(no text)",
		"Answer based on the quote and prior turns when possible. Be concise. If uncertain, say so.",
	);
	return parts.join("\n\n");
}
