import type { CitationTarget } from "@/lib/agent/api";
import { readLayoutIndex, readLayoutSidecar } from "@/lib/pdf/layout/io";
import { cloudRelative, listLocalFiles } from "./files";

/** Resolve saved browser layout data; ambiguous/missing targets remain explicit errors. */
export async function resolveBrowserCitation(
	source: string,
): Promise<CitationTarget> {
	const hash = source.indexOf("#");
	if (hash < 1) throw new Error("citationNotFound");
	const path = cloudRelative(decodeURIComponent(source.slice(0, hash)));
	const fragment = source.slice(hash + 1);
	const query = new URLSearchParams(fragment);
	const files = (await listLocalFiles()).filter((f) => !f.deleted);
	const paper = files
		.filter((f) => f.path.endsWith("/.paper.json"))
		.map((f) => f.path.slice(0, -12))
		.find((p) => path === p || path.startsWith(`${p}/`));
	if (!paper) throw new Error("citationNotFound");
	const pdf = files.find(
		(f) => f.path.startsWith(`${paper}/`) && /\.pdf$/i.test(f.path),
	);
	if (!pdf) throw new Error("pdfMissing");
	const target = {
		paperPath: paper,
		path: pdf.path,
		fragment,
		regionId: "",
		title: null,
	};
	const page = Number(query.get("page"));
	if (query.has("page")) {
		if (!Number.isInteger(page) || page < 1)
			throw new Error("citationNotFound");
		const { getHeadlessPdfEngine } = await import(
			"@/lib/pdf/layout/headless-analyze"
		);
		const { readLocalFile } = await import("./files");
		const engine = await getHeadlessPdfEngine();
		const blob = await readLocalFile(pdf.path);
		const doc = await engine
			.openDocumentBuffer({
				id: crypto.randomUUID(),
				content: await blob.arrayBuffer(),
			})
			.toPromise();
		try {
			if (page > doc.pageCount) throw new Error("citationNotFound");
		} finally {
			await engine.closeDocument(doc).toPromise();
		}
		return {
			...target,
			pageIndex: page - 1,
			bbox: { x: 0, y: 0, w: 1, h: 1 },
			regionId: `page-${page}`,
		};
	}
	const layout = await readLayoutSidecar(`/cloud/${paper}`);
	const regionId = query.get("region");
	if (regionId) {
		const region = layout?.regions.find((r) => r.id === regionId);
		if (region)
			return {
				...target,
				pageIndex: region.pageIndex,
				bbox: region.bbox,
				regionId: region.id,
				title: region.text,
			};
	}
	const section = query.get("section");
	if (section) {
		const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const matches =
			layout?.regions.filter(
				(r) =>
					/title|header/i.test(r.kind) &&
					new RegExp(`^${escaped}(?:\\s|[.:]\\s|$)`, "i").test(
						r.text?.trim() ?? "",
					),
			) ?? [];
		if (matches.length === 1)
			return {
				...target,
				pageIndex: matches[0].pageIndex,
				bbox: matches[0].bbox,
				regionId: matches[0].id,
				title: matches[0].text,
			};
	}
	const index = await readLayoutIndex(`/cloud/${paper}`);
	for (const kind of ["figure", "table", "algorithm", "formula"] as const) {
		const value = query.get(kind);
		if (!value) continue;
		const matches =
			index?.items.filter(
				(item) =>
					item.section === kind &&
					(item.id === value || item.id === `${kind}-${value}`),
			) ?? [];
		if (matches.length === 1)
			return {
				...target,
				pageIndex: matches[0].pageIndex,
				bbox: matches[0].bbox,
				regionId: matches[0].layoutRegionId,
				title: matches[0].title,
			};
	}
	throw new Error("citationNotFound");
}
