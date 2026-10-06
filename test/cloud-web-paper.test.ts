import { expect, it, vi } from "vitest";

vi.mock("../src/lib/cloud/html-reader", () => ({
	publicHtmlUrl: (raw: string) => {
		const url = new URL(raw);
		if (!/^https?:$/.test(url.protocol) || url.username || url.password)
			throw new Error("invalidEndpoint");
		url.hash = "";
		return url.href;
	},
	loadHtmlPage: vi.fn(),
}));
vi.mock("../src/lib/cloud/files", () => ({
	listLocalFiles: vi.fn(),
	writeLocalFile: vi.fn(),
}));
it("routes public web URLs separately from DOI and arXiv lookups", async () => {
	const { isWebPaperQuery } = await import("../src/lib/cloud/web-paper");
	expect(isWebPaperQuery("https://example.org/article")).toBe(true);
	expect(isWebPaperQuery("https://arxiv.org/abs/1706.03762")).toBe(false);
	expect(isWebPaperQuery("https://doi.org/10.1234/example")).toBe(false);
	expect(isWebPaperQuery("Research paper title")).toBe(false);
	expect(isWebPaperQuery("file:///etc/passwd")).toBe(false);
});
it("never replaces an authored or intentionally deleted body file during a repeated import", async () => {
	const { listLocalFiles, writeLocalFile } = await import(
		"../src/lib/cloud/files"
	);
	const { loadHtmlPage } = await import("../src/lib/cloud/html-reader");
	const { cacheWebPaperBody } = await import("../src/lib/cloud/web-paper");
	for (const deleted of [false, true]) {
		vi.mocked(listLocalFiles).mockResolvedValue([
			{ path: "papers/web/PAPER.md", deleted },
		] as never);
		await cacheWebPaperBody({
			path: "papers/web",
			meta_source: "web",
			source_url: "https://example.org/article",
		} as never);
	}
	expect(writeLocalFile).not.toHaveBeenCalled();
	expect(loadHtmlPage).not.toHaveBeenCalled();
});
