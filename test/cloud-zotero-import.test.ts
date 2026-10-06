import { expect, it, vi } from "vitest";

const create = vi.fn(async () => ({
	path: "papers/zotero",
	title: "Imported",
}));
vi.mock("../src/lib/cloud/catalog", () => ({
	listCloudPapers: async () => [],
	createCloudPaper: (...args: unknown[]) => create(...args),
}));
it("imports Zotero JSON bibliography fields rather than treating creators and attachments as Agentero fields", async () => {
	const { importBibliography } = await import("../src/lib/cloud/bibliography");
	const result = await importBibliography(
		JSON.stringify([
			{
				itemType: "journalArticle",
				title: "Imported",
				creators: [
					{ firstName: "Jane", lastName: "Researcher", creatorType: "author" },
				],
				DOI: "10.1234/a",
				publicationTitle: "Journal",
				volume: "2",
				issue: "3",
				pages: "1-8",
				tags: [{ tag: "topic" }],
				attachments: [
					{ mimeType: "application/pdf", url: "https://example.org/paper.pdf" },
				],
			},
		]),
	);
	expect(result.imported).toBe(1);
	expect(create).toHaveBeenCalledWith(
		"Imported",
		"papers",
		expect.objectContaining({
			authors: ["Jane Researcher"],
			doi: "10.1234/a",
			publication: "Journal",
			volume: "2",
			issue: "3",
			pages: "1-8",
			tags: [{ name: "topic", color: null }],
			pdf_url: "https://example.org/paper.pdf",
		}),
	);
});
vi.mock("../src/lib/settings/react-store", () => ({
	getSettings: () => ({
		translator: { baseUrl: "https://translator.example", apiKey: "********" },
	}),
}));
it("uses the configured import protocol for an unsupported local bibliography format", async () => {
	const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
		expect(JSON.parse(String(init.body))).toMatchObject({
			operation: "import",
			content: "%0 Journal Article\n%T Remote record",
			apiKey: "********",
		});
		return Response.json({
			papers: [{ title: "Remote record", authors: ["Author"] }],
		});
	});
	vi.stubGlobal("fetch", fetcher);
	try {
		const { importBibliography } = await import(
			"../src/lib/cloud/bibliography"
		);
		expect(
			(await importBibliography("%0 Journal Article\n%T Remote record"))
				.imported,
		).toBe(1);
		expect(fetcher).toHaveBeenCalledOnce();
		expect(create).toHaveBeenLastCalledWith(
			"Remote record",
			"papers",
			expect.objectContaining({ authors: ["Author"] }),
		);
	} finally {
		vi.unstubAllGlobals();
	}
});
