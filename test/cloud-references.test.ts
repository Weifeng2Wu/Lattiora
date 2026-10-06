import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const paper = {
	path: "papers/self",
	title: "My research",
	doi: "10.1234/self",
};
vi.mock("../src/lib/cloud/catalog", () => ({
	getCloudPaper: async () => paper,
	listCloudPapers: async () => [
		paper,
		{
			path: "papers/attention",
			title: "Attention Is All You Need",
			arxiv_id: "1706.03762v3",
		},
	],
}));
beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubGlobal("navigator", {
		onLine: false,
		locks: { request: (_key: string, fn: () => unknown) => fn() },
	});
});
afterEach(() => vi.unstubAllGlobals());
const bbl = String.raw`\begin{thebibliography}{2}
\bibitem[\protect\citeauthoryear{Vaswani}{2017}]{vaswani}
A.~Vaswani et~al. Attention Is All You Need. 2017. \url{https://arxiv.org/abs/1706.03762v2}
\bibitem{unknown} Unknown author. 2024.
\end{thebibliography}`;
const bib =
	"@article{vaswani,title={Attention Is {All} You Need},author={Ashish Vaswani and Noam Shazeer},year={2017},eprint={1706.03762v2},archiveprefix={arXiv}}";
it("preserves original BBL ordering, enriches by BibTeX key and matches versionless library identifiers", async () => {
	const { parseLocalReferences, matchLibraryReferences } = await import(
		"../src/lib/cloud/references"
	);
	const { listCloudPapers } = await import("../src/lib/cloud/catalog");
	const refs = parseLocalReferences([
		{ path: "a.bbl", text: bbl },
		{ path: "b.bib", text: bib },
	]);
	expect(refs.map((c) => c.display)).toEqual(["[1]", "[2]"]);
	expect(refs[0].metadata.title).toBe("Attention Is All You Need");
	expect(refs[1].status).toBe("unresolved");
	expect(
		matchLibraryReferences(refs, await listCloudPapers(), paper.path)[0]
			.localMatch,
	).toEqual({ paperPath: "papers/attention", matchBy: "arxiv" });
});
it("uses original inline bibliography fallback and never invents titles from raw BBL text", async () => {
	const { parseLocalReferences, enrichReferences } = await import(
		"../src/lib/cloud/references"
	);
	const refs = parseLocalReferences([{ path: "main.tex", text: bbl }]);
	expect(refs[0].source).toBe("tex");
	expect(refs[0].metadata.title).toBeUndefined();
	const enriched = enrichReferences(
		refs,
		[
			{
				title: "Attention Is All You Need",
				authors: ["Ashish Vaswani"],
				year: 2017,
			},
		],
		"s2",
	);
	expect(enriched[0].metadata.title).toBe("Attention Is All You Need");
	expect(enriched[0].id).toBe(refs[0].id);
	expect(enriched[1]).toEqual(refs[1]);
});
it("persists offline parsed references and refuses to overwrite when sources change during online enrichment", async () => {
	const files = await import("../src/lib/cloud/files");
	const refs = await import("../src/lib/cloud/references");
	await files.writeLocalFile("papers/self/source/refs.bbl", new Blob([bbl]));
	await files.writeLocalFile("papers/self/source/refs.bib", new Blob([bib]));
	const first = await refs.parseCloudReferences(paper.path);
	expect(
		(await refs.readCloudReferences(paper.path))?.citations[0].localMatch
			?.paperPath,
	).toBe("papers/attention");
	Object.defineProperty(navigator, "onLine", { value: true });
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			await files.writeLocalFile(
				"papers/self/source/refs.bib",
				new Blob([bib + "\n% concurrently edited"]),
			);
			return Response.json({
				source: "s2",
				citations: [
					{ title: "Attention Is All You Need", arxivId: "1706.03762" },
				],
			});
		}),
	);
	await expect(refs.parseCloudReferences(paper.path, true)).rejects.toThrow(
		"referencesChanged",
	);
	expect((await refs.readCloudReferences(paper.path))?.source.fingerprint).toBe(
		first.source.fingerprint,
	);
});
it("keeps the last sidecar on provider failure when no local bibliography is available", async () => {
	const refs = await import("../src/lib/cloud/references");
	await refs.parseCloudReferences(paper.path);
	Object.defineProperty(navigator, "onLine", { value: true });
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			throw new Error("referencesUnavailable");
		}),
	);
	await expect(refs.parseCloudReferences(paper.path, true)).rejects.toThrow(
		"referencesUnavailable",
	);
	expect((await refs.readCloudReferences(paper.path))?.source.mode).toBe(
		"none",
	);
});
it("does not commit an online result after cancellation", async () => {
	const refs = await import("../src/lib/cloud/references");
	const previous = await refs.parseCloudReferences(paper.path);
	Object.defineProperty(navigator, "onLine", { value: true });
	const controller = new AbortController();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			controller.abort();
			return Response.json({
				source: "s2",
				citations: [{ title: "A new citation" }],
			});
		}),
	);
	await expect(
		refs.parseCloudReferences(paper.path, true, controller.signal),
	).rejects.toThrow();
	expect((await refs.readCloudReferences(paper.path))?.source.fingerprint).toBe(
		previous.source.fingerprint,
	);
});
