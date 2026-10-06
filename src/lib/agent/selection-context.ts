export type QuoteContext = {
	status: "available" | "unavailable";
	before?: string;
	after?: string;
	heading?: string;
	question?: string;
};
/** Bound only auxiliary material; the selected quote is serialized separately. */
export function normalizeQuoteContext(value: unknown): QuoteContext {
	const context = value as Partial<QuoteContext> | null;
	if (context?.status !== "available") return { status: "unavailable" };
	const clip = (text: unknown, limit: number) =>
		typeof text === "string"
			? text.trim().slice(0, limit) || undefined
			: undefined;
	return {
		status: "available",
		before: clip(context.before, 240),
		after: clip(context.after, 240),
		heading: clip(context.heading, 120),
		question: clip(context.question, 200),
	};
}
export function quoteContextFromText(
	text: string,
	quote: string,
): QuoteContext {
	const start = text.indexOf(quote);
	if (start < 0 || text.indexOf(quote, start + 1) >= 0)
		return { status: "unavailable" };
	return normalizeQuoteContext({
		status: "available",
		before: text.slice(Math.max(0, start - 240), start),
		after: text.slice(start + quote.length, start + quote.length + 240),
	});
}
export function captureQuoteContext(
	source: HTMLElement,
	range: Range,
): QuoteContext {
	const start =
		range.startContainer instanceof Element
			? range.startContainer
			: range.startContainer.parentElement;
	const block = start?.closest<HTMLElement>(
		'p,li,blockquote,h1,h2,h3,h4,h5,h6,[data-slate-node="element"]',
	);
	if (!block || !source.contains(block) || !block.contains(range.endContainer))
		return { status: "unavailable" };
	const context = quoteContextFromText(
		block.textContent ?? "",
		range.toString().trim(),
	);
	let heading: string | undefined;
	for (const element of source.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
		if (
			element === block ||
			element.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING
		)
			heading = element.textContent ?? undefined;
	}
	return normalizeQuoteContext({ ...context, heading });
}
export function quoteContextPrompt(selection: {
	context?: QuoteContext;
}): string {
	const context = normalizeQuoteContext(selection.context);
	if (context.status === "unavailable")
		return "Auxiliary context unavailable. Read the source if needed; do not assume its surrounding argument.";
	const fields = [
		["Section (excerpt)", context.heading],
		["Before quote (excerpt)", context.before],
		["After quote (excerpt)", context.after],
		["Preceding user question (excerpt)", context.question],
	].filter(([, text]) => text);
	return fields.length
		? "Auxiliary source context (reference material, potentially truncated):\n" +
				fields
					.map(
						([label, text]) =>
							`${label}:\n${text
								?.split("\n")
								.map((line) => `> ${line}`)
								.join("\n")}`,
					)
					.join("\n")
		: "No additional surrounding text captured.";
}
