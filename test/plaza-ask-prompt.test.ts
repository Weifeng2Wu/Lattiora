import { describe, expect, it } from "vitest";
import { createEmptyThread } from "@/lib/pdf/ask";
import { buildPlazaAskPrompt } from "@/lib/plaza/ask-prompt";

describe("buildPlazaAskPrompt", () => {
	it("includes title, url, quote, and the latest question", () => {
		const thread = createEmptyThread({
			paperPath: "https://example.com/item",
			anchor: {
				page: 1,
				rects: [],
				quote: "Attention is all you need",
				trigger: "selection",
			},
		});
		thread.messages.push({
			id: "u1",
			role: "user",
			content: "What is the claim?",
			createdAt: new Date().toISOString(),
		});
		const prompt = buildPlazaAskPrompt(thread, "What is the claim?", {
			title: "Transformer paper",
			url: "https://example.com/item",
		});
		expect(prompt).toContain("Transformer paper");
		expect(prompt).toContain("https://example.com/item");
		expect(prompt).toContain("Attention is all you need");
		expect(prompt).toContain("What is the claim?");
		expect(prompt).not.toContain("Page:");
	});
});
