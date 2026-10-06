import { cloudLock, localTransaction } from "@/lib/cloud/db";
import { editedFile, filesChanged, readLocalFile } from "@/lib/cloud/files";
import type { PaperRecord_Serialize } from "@/lib/core/bindings";
import {
	frontmatterInterior,
	parseFrontmatterProperties,
	splitFrontmatter,
} from "@/lib/markdown/frontmatter";
import type { PaperNoteMode } from "@/lib/settings";

export const NOTES_TEMPLATE_PATH = ".agentero/templates/NOTES.md";
export const NOTES_TEMPLATE_SEED =
	'---\naliases:\n  - "{{title}}"\n---\n# {{title}}\n\n> {{abstract}}\n\n## Problem\n\n\n## Method\n\n\n## Results\n\n';
export type NotesTemplateSeedResult = { created: boolean };
export async function notesTemplateSeed(
	_vaultPath: string,
): Promise<NotesTemplateSeedResult> {
	const created = await cloudLock("files", () =>
		localTransaction((files) => {
			if (
				files.get(NOTES_TEMPLATE_PATH) &&
				!files.get(NOTES_TEMPLATE_PATH)?.deleted
			)
				return false;
			files.set(
				NOTES_TEMPLATE_PATH,
				editedFile(
					NOTES_TEMPLATE_PATH,
					new Blob([NOTES_TEMPLATE_SEED], { type: "text/markdown" }),
					files.get(NOTES_TEMPLATE_PATH),
				),
			);
			return true;
		}),
	);
	if (created) filesChanged([NOTES_TEMPLATE_PATH]);
	return { created };
}
export function suggestShortAlias(
	title: string,
	authors: string[],
	year: number | null | undefined,
): string {
	for (const separator of [":", "：", " — ", " – ", " - "]) {
		const index = title.indexOf(separator);
		if (index < 0) continue;
		const prefix = title.slice(0, index).trim();
		if (
			prefix.length >= 3 &&
			prefix.length <= 48 &&
			title.slice(index + separator.length).trim()
		)
			return prefix;
	}
	const cjk = /[\u3400-\u9fff]/;
	if (!cjk.test(title)) {
		const stop = new Set(
			"a an the and or but for nor of on at to from by with in into over under".split(
				" ",
			),
		);
		const initials = title
			.split(/[^\p{L}\p{N}]+/u)
			.filter((w) => w && !stop.has(w.toLowerCase()))
			.map((w) => w[0].toUpperCase())
			.join("");
		if (
			initials.length >= 2 &&
			initials.length <= 12 &&
			initials.toLowerCase() !== title.toLowerCase()
		)
			return initials;
	}
	const author = authors[0]?.trim();
	return author && year
		? `${
				cjk.test(author)
					? author
					: author
							.split(/\s+/)
							.at(-1)
							?.replace(/^[,;]+|[,;]+$/g, "")
			} ${year}`
		: "";
}
export function readNoteAliases(markdown: string): string[] | null {
	const { frontmatter } = splitFrontmatter(markdown);
	if (markdown.startsWith("---") && !frontmatter) return null;
	const parsed = parseFrontmatterProperties(frontmatterInterior(frontmatter));
	return parsed.ok
		? (parsed.properties.find((p) => p.key === "aliases")?.items ?? [])
		: null;
}
export function withNoteAliases(markdown: string, aliases: string[]): string {
	if (readNoteAliases(markdown) === null) throw new Error("invalidFrontmatter");
	const { frontmatter, body } = splitFrontmatter(markdown);
	const property = `aliases:\n${[...new Set(aliases.filter((a) => a.trim()))].map((a) => `  - ${JSON.stringify(a)}\n`).join("")}`;
	if (!frontmatter) return `---\n${property}---\n${body}`;
	const interior = frontmatterInterior(frontmatter);
	const replaced = /^aliases:[^\n]*(?:\n[ \t]+[^\n]*)*/m.test(interior)
		? interior.replace(
				/^aliases:[^\n]*(?:\n[ \t]+[^\n]*)*/m,
				property.trimEnd(),
			)
		: `${interior.trimEnd()}\n${property}`;
	return `---\n${replaced.trimEnd()}\n---\n${body}`;
}
export async function renderPaperNotes(
	paper: PaperRecord_Serialize,
	mode: PaperNoteMode,
): Promise<string> {
	const aliases = [
		paper.title,
		suggestShortAlias(paper.title, paper.authors, paper.year),
	].filter(Boolean);
	if (mode === "custom") {
		try {
			const template = await (await readLocalFile(NOTES_TEMPLATE_PATH)).text();
			if (template.trim()) {
				const vars: Record<string, string> = {
					title: paper.title,
					authors: paper.authors.join(", "),
					year: String(paper.year ?? ""),
					date: paper.date ?? "",
					abstract: paper.abstract ?? "",
					arxiv_id: paper.arxiv_id ?? "",
					doi: paper.doi ?? "",
					url: paper.html_url ?? paper.source_url ?? paper.pdf_url ?? "",
					id: paper.id,
				};
				const rendered = template.replace(
					/\{\{(\w+)\}\}/g,
					(raw, key) => vars[key] ?? raw,
				);
				const existing = readNoteAliases(rendered);
				return existing && !existing.length
					? withNoteAliases(rendered, aliases)
					: rendered;
			}
		} catch (error) {
			if (
				!(error instanceof Error && error.message.startsWith("File not found:"))
			)
				throw error;
		}
	}
	const body =
		mode === "blank"
			? ""
			: `# ${paper.title}\n\n${
					mode === "standard" && paper.abstract
						? paper.abstract
								.split("\n")
								.map((line) => `> ${line}`)
								.join("\n") + "\n\n"
						: ""
				}`;
	return withNoteAliases(body, aliases);
}
