import type { PdfAskThread } from "@/lib/pdf/ask/types";

/** Build a single-turn prompt for ACP (includes prior turns for multi-round). */
export function buildPdfAskPrompt(
	thread: PdfAskThread,
	latestUserQuestion: string,
): string {
	const quote = thread.anchor.quote?.trim();
	const page = thread.anchor.page;
	const history = thread.messages
		.filter((m) => m.role === "user" || m.role === "assistant")
		// exclude the just-appended user message if it matches latest
		.slice(0, -1)
		.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
		.join("\n\n");

	const parts = [
		"You are helping the user read a research paper PDF in Lattiora.",
		`Page: ${page}`,
	];
	if (thread.anchor.visualKind === "formula") {
		parts.push(
			"The user attached a crop containing a formula or technical expression.",
			"Explain its purpose, define the notation, describe how the terms interact, and connect it to the surrounding paper. Do not invent missing context.",
		);
	} else if (thread.anchor.visualKind === "figure") {
		parts.push(
			"The user attached a crop containing a figure, chart, table, or other visual region.",
			"Explain the visual structure, axes or legend when present, the main comparison, and the conclusion supported by the crop. Do not invent unreadable values.",
		);
	}
	if (quote) {
		parts.push("Quoted text from the PDF:", `> ${quote}`);
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

export { buildTranslatePrompt } from "@/lib/translate/prompt";
