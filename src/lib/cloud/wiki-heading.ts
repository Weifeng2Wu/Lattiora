import type {
	WikiRenameHeadingArgs,
	WikiRenameHeadingResult,
} from "@/lib/core/bindings";
import {
	extractWikiHeadingAnchors,
	type WikiHeadingAnchor,
} from "@/lib/wiki/heading-rename";
import { cloudLock, localTransaction } from "./db";
import {
	cloudRelative,
	editedFile,
	filesChanged,
	listLocalFiles,
} from "./files";
import { cloudLinkOccurrences, resolveCloudLink } from "./wiki";

type Edit = { start: number; end: number; text: string };
const key = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
const same = (a: string[], b: string[]) =>
	a.length === b.length && a.every((part, i) => part === b[i]);
const under = (a: string[], b: string[]) =>
	a.length >= b.length && b.every((part, i) => part === a[i]);
const suffix = (a: string[], b: string[]) =>
	b.length > 0 &&
	a.length >= b.length &&
	b.every((part, i) => key(part) === key(a[a.length - b.length + i]));
const anchors = (headings: WikiHeadingAnchor[], path: string[]) =>
	headings.filter((heading) => suffix(heading.path, path));
function failure(code: string, paths?: string[]): never {
	throw Object.assign(new Error(code), {
		details: { code, rollback: "not-needed", ...(paths ? { paths } : {}) },
	});
}
function apply(content: string, edits: Edit[]): string {
	const sorted = [...edits].sort((a, b) => a.start - b.start);
	for (let i = 0; i < sorted.length; i++)
		if (
			sorted[i].start < 0 ||
			sorted[i].end > content.length ||
			sorted[i].end < sorted[i].start ||
			(i > 0 && sorted[i].start < sorted[i - 1].end)
		)
			failure("overlappingEdits");
	for (const edit of sorted.reverse())
		content =
			content.slice(0, edit.start) + edit.text + content.slice(edit.end);
	return content;
}

/** Original explicit rename semantics; one local transaction replaces Rust write/rollback. */
export async function renameCloudHeading(
	args: WikiRenameHeadingArgs,
): Promise<WikiRenameHeadingResult> {
	const path = cloudRelative(args.path);
	const newText = args.newText.trim();
	if (!newText || /[\r\n]/.test(newText)) failure("invalidHeading");
	const changed: string[] = [];
	const result = await cloudLock("files", async () => {
		// Snapshot file identities and blobs together. All documents are verified again at commit.
		const records = (await listLocalFiles()).filter(
			(file) =>
				!file.deleted &&
				file.mime !== "inode/directory" &&
				!file.path.split("/").some((part) => part.startsWith(".")),
		);
		const docs = await Promise.all(
			records.map(async (file) => ({
				path: file.path,
				content: /\.(md|mdx|markdown)$/i.test(file.path)
					? await file.data?.text()
					: "",
			})),
		);
		if (docs.some((doc) => doc.content === undefined)) failure("sourceChanged");
		const documents = docs as Array<{ path: string; content: string }>;
		const target = documents.find((doc) => doc.path === path);
		if (!target || target.content !== args.expectedContent)
			failure("sourceChanged");
		const oldHeadings = extractWikiHeadingAnchors(target.content);
		const heading = oldHeadings.find(
			(item) =>
				item.line === args.headingLine && same(item.path, args.headingPath),
		);
		if (!heading) failure("headingMissing");
		if (heading.text === newText) failure("invalidHeading");
		if (anchors(oldHeadings, heading.path).length !== 1)
			failure("ambiguousHeading");
		const lines = target.content.split("\n");
		const line = lines[heading.line - 1];
		const prefix = /^[ \t]*#{1,6} [ \t]*/.exec(line)?.[0];
		if (!prefix) failure("headingMissing");
		const start =
			lines
				.slice(0, heading.line - 1)
				.reduce((sum, line) => sum + line.length + 1, 0) + prefix.length;
		const headingEdit = {
			start,
			end: start + heading.text.length,
			text: newText,
		};
		if (target.content.slice(start, headingEdit.end) !== heading.text)
			failure("sourceChanged");
		const headingOnly = apply(target.content, [headingEdit]);
		const newHeadings = extractWikiHeadingAnchors(headingOnly);
		const newPath = [...heading.path.slice(0, -1), newText];
		if (
			!newHeadings.some(
				(item) => item.line === heading.line && same(item.path, newPath),
			)
		)
			failure("invalidHeading");
		if (anchors(newHeadings, newPath).length !== 1) failure("ambiguousHeading");
		const edits = new Map<string, Edit[]>([[path, [headingEdit]]]);
		for (const doc of documents) {
			for (const occurrence of cloudLinkOccurrences(doc.content)) {
				const link = await resolveCloudLink(
					doc.path,
					occurrence.body,
					occurrence.syntax,
					documents,
				);
				const fragment = link.occurrence.fragment;
				if (link.targetPath !== path || fragment?.kind !== "heading") continue;
				const fragmentPath = fragment.path;
				if (link.status !== "resolved") {
					const possiblyAffected = heading.path.some((_, index) => {
						const tail = heading.path.slice(index);
						return (
							fragmentPath.length >= tail.length &&
							suffix(fragmentPath.slice(0, tail.length), tail)
						);
					});
					if (possiblyAffected) failure("ambiguousHeading");
					continue;
				}
				const matches = anchors(oldHeadings, fragmentPath);
				if (matches.length !== 1 || !under(matches[0].path, heading.path))
					continue;
				const offset = matches[0].path.length - fragmentPath.length;
				const renamed = heading.path.length - 1;
				if (renamed < offset) continue; // A child-only suffix still resolves after its parent changes.
				const replacement = [...fragmentPath];
				replacement[renamed - offset] = newText;
				if (anchors(newHeadings, replacement).length !== 1)
					failure("ambiguousHeading");
				const hash = occurrence.body.indexOf("#");
				const alias =
					occurrence.syntax === "wikilink"
						? occurrence.body.indexOf("|", hash)
						: -1;
				if (hash < 0) failure("overlappingEdits");
				const edit = {
					start: occurrence.bodyStart + hash + 1,
					end:
						occurrence.bodyStart + (alias < 0 ? occurrence.body.length : alias),
					text: replacement.join("#"),
				};
				// Validate the persisted syntax too: delimiter characters in a new
				// heading must not turn a reference into an alias or broken Markdown.
				const rewritten = apply(
					doc.content.slice(occurrence.start, occurrence.end),
					[
						{
							start: edit.start - occurrence.start,
							end: edit.end - occurrence.start,
							text: edit.text,
						},
					],
				);
				const parsed = cloudLinkOccurrences(rewritten);
				if (
					parsed.length !== 1 ||
					parsed[0].start !== 0 ||
					parsed[0].end !== rewritten.length
				)
					failure("invalidHeading");
				const resolved = await resolveCloudLink(
					doc.path,
					parsed[0].body,
					occurrence.syntax,
					documents.map((item) =>
						item.path === path ? { ...item, content: headingOnly } : item,
					),
				);
				if (
					resolved.status !== "resolved" ||
					resolved.targetPath !== path ||
					resolved.occurrence.fragment?.kind !== "heading" ||
					!same(resolved.occurrence.fragment.path, replacement)
				)
					failure("invalidHeading");
				const sourceEdits = edits.get(doc.path) ?? [];
				sourceEdits.push(edit);
				edits.set(doc.path, sourceEdits);
			}
		}
		const dirty = new Set((args.dirtyPaths ?? []).map(cloudRelative));
		const blocked = [...edits.keys()].filter((path) => dirty.has(path)).sort();
		if (blocked.length) failure("unsavedEdits", blocked);
		const prepared = documents
			.filter((doc) => edits.has(doc.path))
			.map((doc) => ({
				path: doc.path,
				data: new Blob([apply(doc.content, edits.get(doc.path) ?? [])], {
					type: "text/markdown",
				}),
			}));
		await localTransaction((files) => {
			for (const record of records) {
				const current = files.get(record.path);
				if (
					!current ||
					current.deleted ||
					current.localId !== record.localId ||
					current.version !== record.version
				)
					failure("sourceChanged");
			}
			// A newly added document may introduce a link that was absent from this plan.
			const originalPaths = new Set(records.map((file) => file.path));
			if (
				[...files.values()].some(
					(file) =>
						!file.deleted &&
						file.mime !== "inode/directory" &&
						!file.path.split("/").some((part) => part.startsWith(".")) &&
						!originalPaths.has(file.path),
				)
			)
				failure("sourceChanged");
			for (const file of prepared) {
				files.set(
					file.path,
					editedFile(file.path, file.data, files.get(file.path)),
				);
				changed.push(file.path);
			}
		});
		return {
			path,
			oldPath: heading.path,
			newPath,
			updatedSources: [...edits.keys()]
				.filter((source) => source !== path)
				.sort(),
			rollback: "not-needed" as const,
		};
	});
	if (changed.length) filesChanged(changed);
	return result;
}
