import type { WikiRenameResult } from "@/lib/core/bindings";
import { type CloudPaper, getCloudPaper, listCloudPapers } from "./catalog";
import { listLocalFiles } from "./files";
import { moveCloudPath } from "./wiki";

/** Original arXiv stem and DOI underscore naming, bounded to a safe path. */
export function recognitionCanonicalStem(
	paper: Pick<CloudPaper, "doi" | "arxiv_id">,
): string | null {
	if (!paper.arxiv_id?.trim() && paper.doi?.trim())
		return paper.doi
			.trim()
			.replace(/[/.]/g, "_")
			.replace(/[\\:*?"<>|]/g, "-")
			.replace(/\p{Cc}/gu, "-")
			.slice(0, 180);
	const value = paper.arxiv_id?.trim();
	if (!value) return null;
	return (
		value
			.replace(/[^a-zA-Z0-9.]+/g, "-")
			.replace(/^[-.]+/, "")
			.slice(0, 60)
			.replace(/[-.]+$/, "") || "paper"
	);
}
function identifier(p: Pick<CloudPaper, "doi" | "arxiv_id">) {
	return {
		doi: p.doi
			?.trim()
			.replace(/^https?:\/\/(?:dx\.)?doi.org\//i, "")
			.toLowerCase(),
		arxiv: p.arxiv_id?.trim().replace(/v\d+$/i, "").toLowerCase(),
	};
}
export async function organizeRecognizedPaper(
	path: string,
	dirtyPaths: string[] = [],
	signal?: AbortSignal,
	completion?: {
		path: string;
		before: string;
		localId: string;
		content: (destination: string) => string;
	},
): Promise<{
	path: string;
	from: string;
	move: WikiRenameResult | null;
	archived: boolean;
	primaryPath?: string;
}> {
	signal?.throwIfAborted();
	if (
		dirtyPaths.some(
			(p) =>
				p.replace(/^\/cloud\//, "") === path ||
				p.replace(/^\/cloud\//, "").startsWith(`${path}/`),
		)
	)
		throw new Error("dirtyDocument");
	const paper = await getCloudPaper(path);
	if (paper.meta_source !== "recognizer")
		return { path, from: path, move: null, archived: false };
	const stem = recognitionCanonicalStem(paper);
	if (!stem) return { path, from: path, move: null, archived: false };
	const own = identifier(paper);
	const duplicate = (await listCloudPapers()).find((p) => {
		if (p.path === path) return false;
		// A stable older-record winner prevents two devices archiving each other.
		if (
			(p.added_at || "").localeCompare(paper.added_at || "") > 0 ||
			(p.added_at === paper.added_at && p.path.localeCompare(path) > 0)
		)
			return false;
		const id = identifier(p);
		return Boolean(
			(own.doi && own.doi === id.doi) || (own.arxiv && own.arxiv === id.arxiv),
		);
	});
	const to = duplicate
		? `${duplicate.path}/attachments/import-${crypto.randomUUID()}`
		: `${path.slice(0, path.lastIndexOf("/"))}/${stem}`;
	if (to === path) return { path, from: path, move: null, archived: false };
	const snapshot = await listLocalFiles();
	const meta = snapshot.find(
		(f) => !f.deleted && f.path === `${path}/.paper.json`,
	);
	if (!meta?.data) throw new Error("paperNotFound");
	// Re-read the exact guarded record: a user edit between lookup and move wins.
	const before = await meta.data.text();
	const current = JSON.parse(before) as CloudPaper;
	if (
		current.meta_source !== "recognizer" ||
		current.doi !== paper.doi ||
		current.arxiv_id !== paper.arxiv_id
	)
		throw new Error("metadataChanged");
	const expectedFiles = Object.fromEntries(
		snapshot
			.filter(
				(f) =>
					!f.deleted &&
					(f.path === path ||
						f.path.startsWith(`${path}/`) ||
						f.path === `${duplicate?.path}/.paper.json`),
			)
			.map((f) => [f.path, f.localId]),
	);
	if (duplicate) {
		const targetMeta = snapshot.find(
			(f) => !f.deleted && f.path === `${duplicate.path}/.paper.json`,
		);
		if (!targetMeta?.data) throw new Error("metadataChanged");
		const targetId = identifier(JSON.parse(await targetMeta.data.text()));
		if (
			!(
				(own.doi && own.doi === targetId.doi) ||
				(own.arxiv && own.arxiv === targetId.arxiv)
			)
		)
			throw new Error("metadataChanged");
	}
	const renameFiles = duplicate
		? { [`${path}/.paper.json`]: `${to}/import-metadata.json` }
		: undefined;
	const rewrites = duplicate
		? []
		: [
				{
					path: `${to}/.paper.json`,
					before,
					after: JSON.stringify({ ...current, path: to }, null, 2),
				},
			];
	if (completion) {
		expectedFiles[completion.path] = completion.localId;
		rewrites.push({
			path: completion.path,
			before: completion.before,
			after: completion.content(to),
		});
	}
	const move = await moveCloudPath(path, to, dirtyPaths, {
		expectedFiles,
		signal,
		renameFiles,
		rewrites,
	});
	return {
		path: to,
		from: path,
		move,
		archived: Boolean(duplicate),
		primaryPath: duplicate?.path,
	};
}
