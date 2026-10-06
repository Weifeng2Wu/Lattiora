import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const paper = {
	path: "papers/test",
	arxiv_id: "2501.00001",
	pdf_url: "https://arxiv.org/pdf/2501.00001",
};
vi.mock("../src/lib/cloud/catalog", () => ({
	getCloudPaper: async () => paper,
}));
beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubGlobal("navigator", {
		locks: { request: (_k: string, fn: () => unknown) => fn() },
	});
});
afterEach(() => vi.unstubAllGlobals());
it("downloads both assets once and preserves user files on repeated runs", async () => {
	const { downloadCloudAssets } = await import("../src/lib/cloud/paper-assets");
	const files = await import("../src/lib/cloud/files");
	await files.writeLocalFile(
		"papers/test/.paper.json",
		new Blob([JSON.stringify(paper)]),
	);
	const fetcher = vi.fn(async (url: string) =>
		url.includes("remote-pdf")
			? new Response("%PDF-1.7 fixture")
			: new Response(
					"\\documentclass{article}\n\\begin{document}source\\end{document}",
				),
	);
	vi.stubGlobal("fetch", fetcher);
	expect(await downloadCloudAssets(paper.path)).toMatchObject({
		pdf: true,
		tex: true,
		errors: [],
	});
	await files.writeLocalFile(
		"papers/test/source/main.tex",
		new Blob(["user editing"]),
	);
	await downloadCloudAssets(paper.path);
	expect(fetcher).toHaveBeenCalledTimes(2);
	expect(
		await (await files.readLocalFile("papers/test/source/main.tex")).text(),
	).toBe("user editing");
});
it("refuses stale download writes and does not persist cancelled responses", async () => {
	const { downloadCloudAssets } = await import("../src/lib/cloud/paper-assets");
	const files = await import("../src/lib/cloud/files");
	await files.writeLocalFile(
		"papers/test/.paper.json",
		new Blob([JSON.stringify(paper)]),
	);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			await files.writeLocalFile(
				"papers/test/.paper.json",
				new Blob(["changed"]),
			);
			return new Response("\\documentclass{article}");
		}),
	);
	const result = await downloadCloudAssets(paper.path);
	expect(result.pdf).toBe(false);
	expect(result.tex).toBe(false);
	expect(result.errors).toContain("assetInputsChanged");
	const controller = new AbortController();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			controller.abort();
			return new Response("%PDF-test");
		}),
	);
	await expect(
		downloadCloudAssets(paper.path, controller.signal),
	).rejects.toThrow();
	expect(
		(await files.listLocalFiles()).filter(
			(f) => f.path.endsWith(".pdf") || f.path.endsWith(".tex"),
		),
	).toHaveLength(0);
});
