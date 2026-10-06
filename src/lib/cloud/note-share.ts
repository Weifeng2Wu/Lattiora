import { splitFrontmatter } from "@/lib/markdown/frontmatter";
import { cloudRelative } from "./files";
import { NOTE_SHARE_MIME, type NoteShareSnapshot } from "./share-protocol";
import {
	cloudLinkOccurrences,
	resolveCloudLink,
	workspaceDocuments,
} from "./wiki";

type Document = { path: string; content: string };
export type NoteShareDraft = {
	sourcePath: string;
	documents: Document[];
	linkedNotes: { path: string; title: string }[];
};
const isNote = (path: string) => /\.(md|mdx|markdown)$/i.test(path);
function titleOf(doc: Document) {
	const { body } = splitFrontmatter(doc.content);
	return (
		body.match(/^#\s+(.+)$/m)?.[1] ||
		doc.path.split("/").at(-1) ||
		doc.path
	)
		.replace(/\.(md|mdx|markdown)$/i, "")
		.slice(0, 240);
}

/** Discover direct note links; inclusion is an explicit choice in the dialog. */
export async function prepareNoteShare(
	sourcePath: string,
	markdown: string,
	documents?: Document[],
): Promise<NoteShareDraft> {
	const path = cloudRelative(sourcePath);
	const docs = [
		{ path, content: markdown },
		...(documents ?? (await workspaceDocuments())).filter(
			(doc) => doc.path !== path,
		),
	];
	const linked = new Set<string>();
	for (const occurrence of cloudLinkOccurrences(markdown)) {
		const target = await resolveCloudLink(
			path,
			occurrence.body,
			occurrence.syntax,
			docs,
		);
		if (
			target.status === "resolved" &&
			target.targetPath &&
			target.targetPath !== path &&
			isNote(target.targetPath)
		)
			linked.add(target.targetPath);
	}
	return {
		sourcePath: path,
		documents: docs,
		linkedNotes: docs
			.filter((doc) => linked.has(doc.path))
			.map((doc) => ({ path: doc.path, title: titleOf(doc) })),
	};
}

/** Only the root and selected direct links enter the public snapshot. */
export async function buildNoteShare(
	draft: NoteShareDraft,
	selectedPaths: string[],
): Promise<Blob> {
	const allowed = new Set(draft.linkedNotes.map((note) => note.path));
	if (selectedPaths.some((path) => !allowed.has(path)))
		throw new Error("invalidShare");
	const paths = [...new Set([draft.sourcePath, ...selectedPaths])];
	const snapshot: NoteShareSnapshot = { version: 1, notes: [] };
	for (const path of paths) {
		const doc = draft.documents.find((item) => item.path === path);
		if (!doc) throw new Error("invalidShare");
		let { body } = splitFrontmatter(doc.content);
		for (const occurrence of cloudLinkOccurrences(body).reverse()) {
			const target = await resolveCloudLink(
				path,
				occurrence.body,
				occurrence.syntax,
				draft.documents,
			);
			// Images remain inert unless they already use a public URL.
			if (
				occurrence.embed &&
				occurrence.syntax === "markdown" &&
				!isNote(target.targetPath ?? "")
			)
				continue;
			const index =
				target.status === "resolved" && target.targetPath
					? paths.indexOf(target.targetPath)
					: -1;
			const raw = body.slice(occurrence.start, occurrence.end);
			const label =
				occurrence.syntax === "wikilink"
					? (occurrence.body.split("|").at(-1) ?? occurrence.body)
					: raw.slice(raw.indexOf("[") + 1, raw.indexOf("]("));
			const escaped = label.replace(/[\\[\]`*_]/g, "\\$&");
			const replacement = index < 0 ? escaped : `[${escaped}](#note=${index})`;
			body =
				body.slice(0, occurrence.start) +
				replacement +
				body.slice(occurrence.end);
		}
		snapshot.notes.push({ title: titleOf(doc), markdown: body });
	}
	return new Blob([JSON.stringify(snapshot)], { type: NOTE_SHARE_MIME });
}
