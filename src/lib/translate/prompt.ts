/**
 * Prompts for the Agent translation provider.
 * Generic surface + PDF selection variant.
 */

/** True when `text` is a numbered batch payload (`[[1]] …`, `[[2]] …`). */
function hasNumberedMarkers(text: string): boolean {
	return /\[{2}\s*\d+\s*\]{2}/.test(text);
}

/**
 * Built-in instruction block (role + direction + rules) with `{{targetLang}}`
 * placeholders. Also the seed filled in by Settings → 翻译 → 翻译提示词; a
 * non-empty `translate.customPrompt` replaces it wholesale.
 */
export const DEFAULT_TRANSLATE_PROMPT_TEMPLATE = `You are a professional academic translator working inside Lattiora, a research paper workbench.

Translate the text below into {{targetLang}}.

Rules:
- The source is prose from a research paper, often extracted from a PDF text layer. Translate the meaning, not the word order: write natural, fluent {{targetLang}} the way a researcher in the field would. Re-order clauses and split long sentences when that reads better.
- Keep mathematics, symbols, variable names, units, inline code, URLs and citation markers ([12], (Smith et al., 2020)) exactly as they appear, including any ⟦n⟧ placeholders.
- Keep figure / table / section / equation numbers unchanged.
- Use the established {{targetLang}} term for each concept and stay consistent; on a term's first occurrence, follow it with the original in parentheses, e.g. 注意力机制（attention）.
- Do not add, drop, summarize or explain anything. No translator notes, no extra headings, no markdown fences.
- Output only the translation.`;

/**
 * Substitute `{{targetLang}}` / `{{sourceLang}}` in a prompt template. The
 * frontend source language is always auto-detected, so `{{sourceLang}}`
 * renders the same wording the built-in prompt uses.
 */
export function renderTranslatePromptTemplate(
	template: string,
	targetLangName: string,
): string {
	return template
		.replaceAll("{{targetLang}}", targetLangName)
		.replaceAll("{{sourceLang}}", "the source language");
}

export function buildTranslatePrompt(opts: {
	text: string;
	targetLangName: string;
	page?: number;
	surface?: string;
	/** Non-empty replaces the default instruction block (role + rules). */
	customPrompt?: string;
}): string {
	const text = opts.text.trim();
	const lang = opts.targetLangName;
	const custom = opts.customPrompt?.trim();
	const template = custom || DEFAULT_TRANSLATE_PROMPT_TEMPLATE;
	const parts = [renderTranslatePromptTemplate(template, lang)];
	if (opts.surface === "pdf-selection" && opts.page != null) {
		parts.push(`Source: research paper PDF, page ${opts.page}.`);
	}
	if (hasNumberedMarkers(text)) {
		parts.push(
			"The text contains several paragraphs, each prefixed with a [[n]] marker. " +
				"Translate every paragraph and keep the same [[n]] markers, in the same " +
				"order, with the same number of paragraphs. Do not merge paragraphs.",
		);
	}
	parts.push("Text:", text);
	return parts.join("\n\n");
}
