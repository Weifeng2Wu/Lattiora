import { isPlazaMentionPath } from "@/lib/agent/plaza-mention";
import { cloudRelative, listLocalFiles, readLocalFile } from "./files";
import { readSkillFile } from "./skills";

export async function readAgentDocument(
	source: string,
	signal?: AbortSignal,
): Promise<string> {
	const path = cloudRelative(source);
	if (path.startsWith(".agents/skills/")) return readSkillFile(path);
	if (
		(path.startsWith(".agentero/") &&
			!path.startsWith(".agentero/plaza-scratch/")) ||
		path.startsWith(".trash/")
	)
		throw new Error("invalidPath");
	const files = (await listLocalFiles()).filter((f) => !f.deleted);
	const exact = files.find((f) => f.path === path);
	if (exact && exact.mime !== "inode/directory" && !/\.pdf$/i.test(path)) {
		if (!/\.(md|txt|json|csv|bib|ris|tex|ya?ml|excalidraw)$/i.test(path))
			throw new Error("unsupportedDocument");
		return (await readLocalFile(path)).text();
	}
	const directory = /\.pdf$/i.test(path)
		? path.slice(0, path.lastIndexOf("/"))
		: path;
	const parsed = files.find((f) => f.path === `${directory}/source/parsed.md`);
	if (parsed) return (await readLocalFile(parsed.path)).text();
	const pdf = files.find(
		(f) =>
			(f.path === path || f.path.startsWith(`${path}/`)) &&
			/\.pdf$/i.test(f.path),
	);
	if (pdf) {
		const { extractCloudPdf } = await import("./pdf");
		const result = await extractCloudPdf(pdf.path, { signal });
		if (result.scannedPages.length) throw new Error("scannedPdf");
		return result.text;
	}
	// A directory is a path listing, never a pretend full-text document.
	const children = files
		.filter((f) => f.path.startsWith(`${path}/`))
		.map((f) => f.path);
	if (!children.length) throw new Error("notFound");
	return `Directory listing (read individual documents):\n${children.join("\n")}`;
}
export async function agentDocumentContext(
	paths: string[],
	signal?: AbortSignal,
): Promise<string> {
	const documents = [];
	let size = 0;
	for (const path of new Set(paths)) {
		if (isPlazaMentionPath(path)) continue; // metadata expanded by the original composer
		signal?.throwIfAborted();
		const text = await readAgentDocument(path, signal);
		size += path.length + text.length + 50;
		if (size > 240000) throw new Error("contextTooLarge");
		documents.push(
			`<document path=${JSON.stringify(path)}>\n${text}\n</document>`,
		);
	}
	return documents.join("\n\n");
}
