import { expect, it } from "vitest";
import {
	normalizeQuoteContext,
	quoteContextFromText,
} from "@/lib/agent/selection-context";
import { selectionsPromptBlock } from "@/lib/agent/selection-prompt";

it("includes immediate neighbors without repeating the selected quote and bounds context", () => {
	const context = quoteContextFromText(
		`${"a".repeat(1000)}QUOTE${"b".repeat(1000)}`,
		"QUOTE",
	);
	expect(context.before).toBe("a".repeat(240));
	expect(context.after).toBe("b".repeat(240));
	const normalized = normalizeQuoteContext({
		...context,
		heading: "h".repeat(500),
		question: "q".repeat(500),
	});
	expect(normalized.heading).toHaveLength(120);
	expect(normalized.question).toHaveLength(200);
	const prompt = selectionsPromptBlock([
		{
			id: "one",
			text: "QUOTE",
			sourcePath: "notes/test.md",
			origin: "markdown",
			pinned: true,
			context: normalized,
			comment: "Explain this",
		},
	]);
	expect(prompt.match(/QUOTE/g)).toHaveLength(1);
	expect(prompt).toContain("Auxiliary source context");
	expect(prompt).toContain("User comment on this selection:\nExplain this");
});
it("fails explicitly for missing or ambiguous source matches", () => {
	expect(quoteContextFromText("same and same", "same").status).toBe(
		"unavailable",
	);
	expect(quoteContextFromText("different", "quote").status).toBe("unavailable");
	expect(
		selectionsPromptBlock([
			{
				id: "one",
				text: "quote",
				sourcePath: "paper",
				origin: "pdf",
				page: 3,
				pinned: true,
			},
		]),
	).toContain("Auxiliary context unavailable");
});
