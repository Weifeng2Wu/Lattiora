import { splitFrontmatter } from "@/lib/markdown/frontmatter";
import { readNoteAliases, withNoteAliases } from "@/lib/vault/note-template";

const placeholders = new Set([
	"",
	"pdf",
	"untitled",
	"untitled paper",
	"placeholder",
	"placeholder title",
	"notes",
	"paper",
	"未命名",
	"未命名论文",
	"无标题",
]);
const stripPdf = (s: string) => s.trim().replace(/\.pdf$/i, "");
const sameOld = (value: string, old: string) => {
	if (!value.trim() || !old.trim()) return false;
	const a = value.trim().toLowerCase(),
		b = old.trim().toLowerCase();
	return (
		a === b ||
		stripPdf(a) === stripPdf(b) ||
		stripPdf(a.split(/[\\/]/).at(-1) ?? a) ===
			stripPdf(b.split(/[\\/]/).at(-1) ?? b)
	);
};
/** Port of original wiki/notes.rs: keep custom headings and old link aliases. */
export function patchNoteTitle(
	markdown: string,
	oldTitle: string,
	newTitle: string,
): string {
	const title = newTitle.trim();
	if (!title) return markdown;
	const split = splitFrontmatter(markdown);
	if (markdown.startsWith("---") && !split.frontmatter)
		throw new Error("invalidFrontmatter");
	// Parse only aliases: unrelated nested YAML or multiline properties stay byte-for-byte intact.
	const blocks = [
		...split.frontmatter.matchAll(/^aliases:[^\n]*(?:\n[ \t]+[^\n]*)*/gm),
	];
	if (blocks.length > 1) throw new Error("invalidFrontmatter");
	const block = blocks[0];
	const aliases = block ? readNoteAliases(`---\n${block[0]}\n---\n`) : [];
	if (aliases === null) throw new Error("invalidFrontmatter");
	const aliasDoc = withNoteAliases("", [
		...aliases,
		...(oldTitle.trim() ? [oldTitle.trim()] : []),
		title,
	]);
	const aliasInterior = splitFrontmatter(aliasDoc).frontmatter.replace(
		/^---\n|---\n$/g,
		"",
	);
	let frontmatter = split.frontmatter;
	if (!frontmatter) frontmatter = splitFrontmatter(aliasDoc).frontmatter;
	else if (block)
		frontmatter =
			frontmatter.slice(0, block.index) +
			aliasInterior.trimEnd() +
			frontmatter.slice((block.index ?? 0) + block[0].length);
	else
		frontmatter = frontmatter.replace(
			/---[ \t]*(?:\r?\n)?$/,
			`${aliasInterior}---\n`,
		);
	const body = split.body;
	const eol = body.includes("\r\n") ? "\r\n" : "\n";
	const lines = body.split(/\r?\n/);
	const h1 = lines.findIndex((line) => line.startsWith("# "));
	const placeholder = (s: string) => placeholders.has(s.trim().toLowerCase());
	if (h1 >= 0) {
		const heading = lines[h1].slice(2).trim();
		if (sameOld(heading, oldTitle) || placeholder(heading))
			lines[h1] = `# ${title}`;
	} else {
		const userNotes = lines.some((line) => {
			const s = line.trim();
			return (
				s &&
				!s.startsWith(">") &&
				s !== "---" &&
				s !== "***" &&
				!sameOld(s, oldTitle) &&
				!placeholder(s)
			);
		});
		if (!userNotes) {
			const raw = lines.findIndex(
				(line) => line.trim() && (sameOld(line, oldTitle) || placeholder(line)),
			);
			if (raw >= 0) lines[raw] = `# ${title}`;
			else lines.unshift(`# ${title}`);
		}
	}
	return frontmatter + lines.join(eol);
}
