import i18n from "@/i18n";
import type { PaperExportResult, PaperImportResult } from "@/lib/core/bindings";
import { type CloudPaper, createCloudPaper, listCloudPapers } from "./catalog";
import { mapTranslatorItem } from "./zotero-item";

type RecordFields = Record<string, string>;

/** Balanced BibTeX fields, including multiline/nested braces and quoted values. */
export function parseBibtex(content: string): RecordFields[] {
	const records: RecordFields[] = [];
	let cursor = 0;
	while (cursor < content.length) {
		const header = /@(\w+)\s*[{(]\s*([^,\s]+)\s*,/g;
		header.lastIndex = cursor;
		const match = header.exec(content);
		if (!match) break;
		cursor = header.lastIndex;
		const fields: RecordFields = {
			key: match[2],
			type: match[1].toLowerCase(),
		};
		while (cursor < content.length) {
			while (/[\s,]/.test(content[cursor] || "") && cursor < content.length)
				cursor++;
			if (content[cursor] === "}" || content[cursor] === ")") {
				cursor++;
				break;
			}
			const field = /^([\w-]+)\s*=\s*/.exec(content.slice(cursor));
			if (!field) throw new Error(`Invalid BibTeX near character ${cursor}`);
			cursor += field[0].length;
			let value = "";
			let more = true;
			while (more) {
				while (/\s/.test(content[cursor] || "") && cursor < content.length)
					cursor++;
				const delimiter = content[cursor];
				if (delimiter === "{" || delimiter === '"') {
					cursor++;
					let depth = 1;
					while (cursor < content.length && depth) {
						const ch = content[cursor++];
						if (ch === "\\" && cursor < content.length) {
							value += ch + content[cursor++];
							continue;
						}
						if (delimiter === "{" && ch === "{") depth++;
						if (
							(delimiter === "{" && ch === "}") ||
							(delimiter === '"' && ch === '"')
						)
							depth--;
						if (depth) value += ch;
					}
					if (depth) throw new Error("Unclosed BibTeX field");
				} else {
					const token = /^[^\s,#})]+/.exec(content.slice(cursor));
					if (!token)
						throw new Error(`Invalid BibTeX value near character ${cursor}`);
					value += token[0];
					cursor += token[0].length;
				}
				while (/\s/.test(content[cursor] || "") && cursor < content.length)
					cursor++;
				more = content[cursor] === "#";
				if (more) cursor++;
			}
			fields[field[1].toLowerCase()] = value.replace(/[{}]/g, "").trim();
		}
		if (!["comment", "preamble", "string"].includes(fields.type))
			records.push(fields);
	}
	return records;
}

function parseRis(content: string): RecordFields[] {
	const records: RecordFields[] = [];
	let fields: RecordFields = {};
	const map: Record<string, string> = {
		TI: "title",
		T1: "title",
		AB: "abstract",
		PY: "year",
		Y1: "year",
		DO: "doi",
		JO: "journal",
		T2: "journal",
		VL: "volume",
		IS: "number",
		PB: "publisher",
		UR: "url",
		SP: "pages",
	};
	let last = "";
	for (const line of content.split(/\r?\n/)) {
		const match = /^([A-Z\d]{2})\s{2}-\s?(.*)$/.exec(line);
		if (!match) {
			if (last && line.trim()) fields[last] = `${fields[last]} ${line.trim()}`;
			continue;
		}
		const [, key, value] = match;
		if (key === "TY") fields = { type: value };
		else if (key === "ER") {
			records.push(fields);
			fields = {};
		} else if (key === "AU" || key === "A1")
			fields.author = [fields.author, value].filter(Boolean).join(" and ");
		else if (key === "KW")
			fields.keywords = [fields.keywords, value].filter(Boolean).join(",");
		else if (map[key]) {
			last = map[key];
			fields[last] = value;
		}
	}
	return records;
}

export async function importBibliography(
	content: string,
	parent = "papers",
): Promise<PaperImportResult> {
	const result: PaperImportResult = {
		imported: 0,
		skipped: 0,
		paths: [],
		titles: [],
		errors: [],
	};
	const trimmed = content.trim();
	let records: Array<Partial<CloudPaper>>;
	if (trimmed.startsWith("[")) {
		const raw: unknown = JSON.parse(trimmed);
		if (!Array.isArray(raw)) throw new Error("Expected a JSON array of papers");
		records = raw.map((item: unknown) => {
			if (
				!item ||
				typeof item !== "object" ||
				!("title" in item) ||
				typeof item.title !== "string"
			)
				throw new Error("Invalid paper JSON");
			if ("creators" in item || "itemType" in item) {
				const mapped = mapTranslatorItem(item, "");
				if (!mapped)
					throw new Error(i18n.t("cloud:errors.invalidProviderResponse"));
				return mapped;
			}
			return item as Partial<CloudPaper>;
		});
	} else {
		const parsed = /^TY\s{2}-/m.test(trimmed)
			? parseRis(trimmed)
			: parseBibtex(trimmed);
		records = parsed.map((r) => ({
			title: r.title,
			authors: r.author?.split(/\s+and\s+/i) || [],
			year: Number.parseInt(r.year, 10) || undefined,
			date: r.year,
			doi: r.doi,
			abstract: r.abstract,
			publication: r.journal || r.booktitle,
			volume: r.volume,
			issue: r.number,
			pages: r.pages,
			publisher: r.publisher,
			source_url: r.url,
			bibtex_key: r.key,
			tags: (r.keywords || "")
				.split(/[,;]/)
				.filter(Boolean)
				.map((name) => ({ name: name.trim(), color: null })),
		}));
	}
	if (!records.length) {
		const { getSettings } = await import("@/lib/settings/react-store");
		const translator = getSettings().translator;
		if (translator.enabled !== false && translator.baseUrl) {
			const { cloudFetch } = await import("./sync");
			const result = await cloudFetch("/api/translator", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...translator, operation: "import", content }),
			});
			records = (await result.json()).papers;
		}
	}
	if (!records.length)
		throw new Error(
			"No bibliography entries found; supported formats are BibTeX, RIS, and Agentero JSON",
		);
	const existing = await listCloudPapers();
	const identifiers = new Set(
		existing.flatMap((p) =>
			[p.doi?.toLowerCase(), p.arxiv_id, p.title.toLowerCase()].filter(
				(v): v is string => Boolean(v),
			),
		),
	);
	for (const record of records) {
		if (!record.title?.trim()) {
			result.errors.push("An entry has no title");
			continue;
		}
		const keys = [
			record.doi?.toLowerCase(),
			record.arxiv_id,
			record.title.toLowerCase(),
		].filter((v): v is string => Boolean(v));
		if (keys.some((key) => identifiers.has(key))) {
			result.skipped++;
			continue;
		}
		try {
			const { path: _path, id: _id, ...metadata } = record;
			const paper = await createCloudPaper(record.title, parent, metadata);
			result.imported++;
			result.paths.push(paper.path);
			result.titles.push(paper.title);
			for (const key of keys) identifiers.add(key);
		} catch (error) {
			result.errors.push(
				`${record.title}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	return result;
}

export async function exportBibliography(
	format = "bibtex",
): Promise<PaperExportResult> {
	const papers = await listCloudPapers();
	let content: string;
	let extension: string;
	if (format === "json") {
		content = JSON.stringify(papers, null, 2);
		extension = "json";
	} else if (format === "ris") {
		content = papers
			.map((p) =>
				[
					`TY  - JOUR`,
					`TI  - ${p.title}`,
					...p.authors.map((a) => `AU  - ${a}`),
					p.year && `PY  - ${p.year}`,
					p.doi && `DO  - ${p.doi}`,
					p.publication && `JO  - ${p.publication}`,
					p.abstract && `AB  - ${p.abstract}`,
					"ER  - ",
				]
					.filter(Boolean)
					.join("\n"),
			)
			.join("\n\n");
		extension = "ris";
	} else if (format === "bibtex" || format === "biblatex") {
		const escapeBibtex = (s: string) =>
			s.replace(/\\/g, "\\textbackslash{}").replace(/([&%$#_{}])/g, "\\$1");
		const keys = new Set<string>();
		content = papers
			.map((p, index) => {
				let key =
					(p.bibtex_key || p.id).replace(/[^\w:-]/g, "") || `paper${index + 1}`;
				if (keys.has(key)) key += `_${index + 1}`;
				keys.add(key);
				const fields = {
					title: p.title,
					author: p.authors.join(" and "),
					year: p.year,
					doi: p.doi,
					journal: p.publication,
					volume: p.volume,
					number: p.issue,
					pages: p.pages,
					publisher: p.publisher,
					abstract: p.abstract,
					url: p.source_url || p.html_url,
				};
				return `@article{${key},\n${Object.entries(fields)
					.filter(([, value]) => value)
					.map(
						([name, value]) => `  ${name} = {${escapeBibtex(String(value))}}`,
					)
					.join(",\n")}\n}`;
			})
			.join("\n\n");
		extension = "bib";
	} else throw new Error(`Unsupported bibliography format: ${format}`);
	return {
		format,
		content,
		count: papers.length,
		filename: `agentero-library.${extension}`,
	};
}
