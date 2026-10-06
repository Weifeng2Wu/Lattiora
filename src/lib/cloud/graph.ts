import type { GraphEdge, GraphNode, ResearchGraph } from "@/lib/graph/model";
import { listCloudPapers } from "./catalog";
import { listLocalFiles } from "./files";
import type { CiteSidecar } from "./reference-types";
import { matchLibraryReferences } from "./references";
import { cloudDocumentLinks, workspaceDocuments } from "./wiki";

export async function loadResearchGraph(): Promise<ResearchGraph> {
	const [documents, papers, files] = await Promise.all([
		workspaceDocuments(),
		listCloudPapers(),
		listLocalFiles(),
	]);
	const paperPaths = papers
		.map((paper) => paper.path)
		.sort((a, b) => b.length - a.length);
	const owner = (path: string) =>
		paperPaths.find((paper) => path === paper || path.startsWith(`${paper}/`));
	const nodes: GraphNode[] = papers.map((paper) => ({
		id: paper.path,
		title: paper.title,
		kind: "paper",
	}));
	for (const doc of documents) {
		if (!owner(doc.path) && /\.(md|mdx|markdown)$/i.test(doc.path))
			nodes.push({
				id: doc.path,
				title:
					doc.content.match(/^#\s+(.+)$/m)?.[1] ??
					doc.path.split("/").at(-1) ??
					doc.path,
				kind: "note",
			});
	}
	nodes.sort(
		(a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
	);
	const ids = new Set(nodes.map((node) => node.id));
	const edges = new Map<string, GraphEdge>();
	const add = (source: string, target: string, kind: GraphEdge["kind"]) => {
		if (source === target || !ids.has(source) || !ids.has(target)) return;
		edges.set(JSON.stringify([source, target, kind]), { source, target, kind });
	};
	for (const doc of documents) {
		if (
			!/\.(md|mdx|markdown)$/i.test(doc.path) ||
			/\/(source|marks)\//.test(doc.path)
		)
			continue;
		for (const link of await cloudDocumentLinks(doc, documents)) {
			if (link.status === "resolved" && link.targetPath)
				add(
					owner(doc.path) ?? doc.path,
					owner(link.targetPath) ?? link.targetPath,
					"link",
				);
		}
	}
	let unavailable = 0;
	for (const file of files) {
		if (file.deleted || !file.path.endsWith("/source/agentero-cite.json"))
			continue;
		const source = owner(file.path);
		if (!source) continue;
		try {
			if (!file.data) throw new Error("notCached");
			const sidecar = JSON.parse(await file.data.text()) as CiteSidecar;
			if (sidecar.schemaVersion !== 1 || !Array.isArray(sidecar.citations))
				throw new Error("referencesInvalid");
			for (const citation of matchLibraryReferences(
				sidecar.citations,
				papers,
				source,
				true,
			))
				if (citation.localMatch)
					add(source, citation.localMatch.paperPath, "citation");
		} catch {
			unavailable++;
		}
	}
	return { nodes, edges: [...edges.values()], unavailable };
}
