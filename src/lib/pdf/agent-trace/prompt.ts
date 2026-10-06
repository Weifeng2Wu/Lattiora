/**
 * Build the multimodal visual-annotation prompt for ACP runOnce.
 * Images are sent separately in Annotation 1…N order via `images`.
 */

import type { PdfVisualTraceMessage } from "@/lib/pdf/agent-trace/types";

export type VisualAnnotationPromptItem = {
	/** 1-based PDF page number. */
	page: number;
	comment: string;
};

export function buildVisualAnnotationsPrompt(
	items: VisualAnnotationPromptItem[],
): string {
	const annotations = items.map((item) => ({
		page: Math.max(1, Math.floor(item.page)),
		comment: item.comment.trim(),
	}));

	const n = annotations.length;
	if (n === 0) {
		return [
			"You are reviewing visual annotations from a research paper PDF.",
			"No annotations were provided.",
		].join("\n\n");
	}

	const parts: string[] = [
		`You are reviewing ${n} visual annotation${n === 1 ? "" : "s"} from a research paper PDF.`,
		"Answer every annotation separately and in the original order.",
		"Use these exact headings:",
		Array.from({ length: n }, (_, i) => `## Annotation ${i + 1}`).join("\n"),
		[
			"For each annotation:",
			"- Respond using the corresponding image (Image 1 maps to Annotation 1, and so on).",
			"- Do not merge or skip annotations.",
			"- Do not invent unreadable details.",
			"- State uncertainty explicitly.",
		].join("\n"),
	];

	for (let i = 0; i < n; i++) {
		const item = annotations[i];
		const comment = item.comment || "(no comment)";
		parts.push(
			[
				`Annotation ${i + 1} — page ${item.page}`,
				`User comment: ${comment}`,
			].join("\n"),
		);
	}

	return parts.join("\n\n");
}

/**
 * Follow-up turn for an in-place visual-annotation chat (Cmd+Enter / pin hover).
 * Includes crop context + prior turns; images are only attached on the first send.
 */
export function buildVisualTraceContinuePrompt(input: {
	page: number;
	/** Original region comment (first user intent). */
	comment: string;
	/** Full transcript including the just-appended latest user message. */
	messages: PdfVisualTraceMessage[];
	latestUserQuestion: string;
}): string {
	const page = Math.max(1, Math.floor(input.page));
	const history = input.messages
		.filter((m) => m.role === "user" || m.role === "assistant")
		.slice(0, -1)
		.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
		.join("\n\n");
	const parts = [
		"You are helping the user discuss a visual region from a research paper PDF in Lattiora.",
		`Page: ${page}`,
		"A crop of the selected region was attached on the first turn of this thread.",
	];
	const seed = input.comment.trim();
	if (seed) {
		parts.push(`Original annotation comment: ${seed}`);
	}
	if (history) {
		parts.push("Earlier turns in this visual annotation thread:", history);
	}
	const q = input.latestUserQuestion.trim();
	parts.push(
		"User question:",
		q || "(no text)",
		"Answer based on the crop context and prior turns when possible. Be concise. If uncertain, say so.",
	);
	return parts.join("\n\n");
}
