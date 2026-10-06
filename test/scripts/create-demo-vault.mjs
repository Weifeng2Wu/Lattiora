#!/usr/bin/env node
/**
 * Create a Agentero demo vault matching the current data model:
 * - AGENTS.md, papers/, notes/, assets/, .agentero/catalog.sqlite
 * - No default PAPERS.md / library.bib
 * - Paper folders as minimal units (flat + nested under papers/)
 * - Loose PDFs / images outside papers/ (center-pane preview fixtures)
 * - Catalog SQLite schema_version = 3 (matches Host schema.rs)
 * - Optional metadata.json for transition / external tools
 *
 * Usage:
 *   node test/scripts/create-demo-vault.mjs [path]
 *   node test/scripts/create-demo-vault.mjs --downloads
 *   node test/scripts/create-demo-vault.mjs --empty [path]
 *   node test/scripts/create-demo-vault.mjs --verify [path]
 *
 * Defaults:
 *   --downloads → ~/Downloads/agentero-demo-vault
 *   no path     → ./tmp/agentero-demo-vault
 */

import { execFileSync } from "node:child_process";
import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

/** Must match `src-tauri/src/services/catalog/schema.rs` SCHEMA_VERSION. */
const SCHEMA_VERSION = 3;

/**
 * Fresh CREATE for schema v3 (v1 base + v2 Translator cols + v3 is_read).
 * Prefer full CREATE over stepwise ALTER when scaffolding a new demo DB.
 */
const DDL = `
CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS papers (
    path            TEXT PRIMARY KEY NOT NULL,
    id              TEXT NOT NULL,
    type            TEXT NOT NULL,
    title           TEXT NOT NULL,
    authors_json    TEXT NOT NULL DEFAULT '[]',
    year            INTEGER,
    abstract        TEXT,
    tags_json       TEXT NOT NULL DEFAULT '[]',
    arxiv_id        TEXT,
    doi             TEXT,
    pdf_url         TEXT,
    html_url        TEXT,
    source_url      TEXT,
    body_source     TEXT,
    body_quality    TEXT,
    bibtex_key      TEXT,
    citation_count  INTEGER,
    status          TEXT NOT NULL DEFAULT 'completed',
    summary         TEXT,
    added_at        TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    creators_json   TEXT,
    date            TEXT,
    isbn            TEXT,
    issn            TEXT,
    pmid            TEXT,
    publication     TEXT,
    volume          TEXT,
    issue           TEXT,
    pages           TEXT,
    publisher       TEXT,
    place           TEXT,
    series          TEXT,
    language        TEXT,
    zotero_item_type TEXT,
    meta_source     TEXT,
    extra           TEXT,
    is_read         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_papers_id ON papers(id);
CREATE INDEX IF NOT EXISTS idx_papers_year ON papers(year);
CREATE INDEX IF NOT EXISTS idx_papers_type ON papers(type);
CREATE INDEX IF NOT EXISTS idx_papers_status ON papers(status);
CREATE INDEX IF NOT EXISTS idx_papers_arxiv ON papers(arxiv_id);
CREATE INDEX IF NOT EXISTS idx_papers_doi ON papers(doi);
CREATE INDEX IF NOT EXISTS idx_papers_bibtex ON papers(bibtex_key);
CREATE INDEX IF NOT EXISTS idx_papers_pmid ON papers(pmid);
CREATE INDEX IF NOT EXISTS idx_papers_isbn ON papers(isbn);
CREATE INDEX IF NOT EXISTS idx_papers_is_read ON papers(is_read);
`;

/** @typedef {{
 *   id: string;
 *   path: string;
 *   title: string;
 *   authors: string[];
 *   year: number;
 *   abstract: string;
 *   tags: string[];
 *   bibtex: string;
 *   notes: string;
 *   is_read?: boolean;
 * }} PaperSeed */

/** @type {PaperSeed[]} */
const PAPERS = [
	{
		id: "1706.03762",
		path: "papers/nlp/transformers/1706.03762",
		title: "Attention Is All You Need",
		authors: [
			"Ashish Vaswani",
			"Noam Shazeer",
			"Niki Parmar",
			"Jakob Uszkoreit",
			"Llion Jones",
			"Aidan N. Gomez",
			"Łukasz Kaiser",
			"Illia Polosukhin",
		],
		year: 2017,
		abstract:
			"We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.",
		tags: ["transformer", "attention", "nlp"],
		bibtex: "vaswani2017attention",
		is_read: true,
		notes: `# NOTES — Attention Is All You Need

# 解决了什么问题

序列建模长期依赖 recurrence / convolution，并行差。

# 方法是什么

Multi-head self-attention + positional encoding（Transformer）。

# 效果怎么样

机器翻译等任务上达到 SOTA，并成为后续 LLM 骨干。

## Related

- Concept: [[notes/attention]]
- Idea: [[notes/idea]]
- Follow-ups: [[papers/nlp/pretrain/1810.04805/NOTES]] · [[papers/nlp/pretrain/2005.14165/NOTES]]
`,
	},
	{
		id: "1810.04805",
		path: "papers/nlp/pretrain/1810.04805",
		title:
			"BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
		authors: [
			"Jacob Devlin",
			"Ming-Wei Chang",
			"Kenton Lee",
			"Kristina Toutanova",
		],
		year: 2019,
		abstract:
			"We introduce BERT, designed to pre-train deep bidirectional representations from unlabeled text.",
		tags: ["bert", "pretraining", "nlp"],
		bibtex: "devlin2019bert",
		is_read: true,
		notes: `# NOTES — BERT

# 解决了什么问题

单向 LM 难做深层双向上下文。

# 方法是什么

Masked LM + NSP 预训练，微调下游任务。

# 效果怎么样

GLUE 等理解任务大幅提升。

## Related

- Base architecture: [[papers/nlp/transformers/1706.03762/NOTES]]
- Concept: [[notes/attention]]
- Scaling: [[papers/nlp/pretrain/2005.14165/NOTES]]
`,
	},
	{
		id: "2005.14165",
		path: "papers/nlp/pretrain/2005.14165",
		title: "Language Models are Few-Shot Learners",
		authors: ["Tom B. Brown", "Benjamin Mann", "Nick Ryder", "Melanie Subbiah"],
		year: 2020,
		abstract:
			"We train GPT-3, an autoregressive language model with 175 billion parameters, and test its performance in the few-shot setting.",
		tags: ["gpt", "llm", "few-shot"],
		bibtex: "brown2020language",
		is_read: false,
		notes: `# NOTES — GPT-3

# 解决了什么问题

小模型微调成本高；希望 in-context few-shot。

# 方法是什么

超大规模自回归预训练 + prompt 示例。

# 效果怎么样

多种 NLP 任务 few-shot 表现接近微调基线。

## Related

- Transformer: [[papers/nlp/transformers/1706.03762/NOTES]]
- BERT contrast: [[papers/nlp/pretrain/1810.04805/NOTES]]
- Optimizers: [[papers/optimization/1412.6980/NOTES]]
`,
	},
	{
		id: "1412.6980",
		path: "papers/optimization/1412.6980",
		title: "Adam: A Method for Stochastic Optimization",
		authors: ["Diederik P. Kingma", "Jimmy Ba"],
		year: 2015,
		abstract:
			"We introduce Adam, an algorithm for first-order gradient-based optimization of stochastic objective functions.",
		tags: ["optimization", "adam"],
		bibtex: "kingma2015adam",
		is_read: false,
		notes: `# NOTES — Adam

# 解决了什么问题

需要自适应学习率且实现简单的优化器。

# 方法是什么

一阶矩 + 二阶矩估计与偏差校正。

# 效果怎么样

成为深度学习默认优化器之一。

## Related

- Used in: [[papers/nlp/transformers/1706.03762/NOTES]] · [[papers/nlp/pretrain/2005.14165/NOTES]]
- Vision era: [[papers/vision/1512.03385/NOTES]]
`,
	},
	{
		id: "1512.03385",
		path: "papers/vision/1512.03385",
		title: "Deep Residual Learning for Image Recognition",
		authors: ["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
		year: 2016,
		abstract:
			"We present a residual learning framework to ease the training of networks that are substantially deeper than those used previously.",
		tags: ["resnet", "vision", "cnn"],
		bibtex: "he2016deep",
		is_read: false,
		notes: `# NOTES — ResNet

# 解决了什么问题

极深网络难训练、精度退化。

# 方法是什么

残差连接 / identity shortcut。

# 效果怎么样

ImageNet 等视觉任务显著提升，成为骨干网络。

## Related

- Optimizers: [[papers/optimization/1412.6980/NOTES]]
`,
	},
];

/** Loose media outside papers/ — exercises arbitrary-path PDF / image preview. */
const LOOSE_MEDIA = {
	/** Vault-relative paths for verify. */
	pdfs: ["assets/sample.pdf", "notes/attachments/reading-list.pdf"],
	images: [
		"assets/figures/red-pixel.png",
		"assets/figures/sample.jpg",
		"assets/figures/sample.gif",
		"assets/figures/sample.webp",
		"assets/figures/diagram.svg",
		"assets/figures/sample.bmp",
		"assets/figures/favicon.ico",
	],
};

const AGENTS_MD = `# AGENTS.md

This file is the L0 map for agents working in this Agentero research vault.

## Layout

- \`papers/\` — paper folders at **any depth**. A paper folder is the minimal unit (has \`NOTES.md\`, optional \`PAPER.md\` / \`marks/\`, and \`source/\`).
- \`notes/\` — free-form concept notes (\`[[wikilinks]]\` welcome). May also hold loose PDFs under \`notes/attachments/\`.
- \`assets/\` — non-paper media (sample PDF / figures) for preview; not catalogued as papers.
- \`.agentero/catalog.sqlite\` — paper **catalog** (collection + metadata). There is usually **no** root \`PAPERS.md\` unless exported.

## Progressive disclosure

1. Start with this file; use the app catalog or scan \`papers/**/NOTES.md\`.
2. Open \`{paper}/NOTES.md\` for a locked paper.
3. Then \`marks/\` → optional \`PAPER.md\` → \`source/\` only as needed.

## Rules

- Keep \`[[wikilinks]]\` as written.
- Cite Vault-relative paths; end substantial answers with \`## Sources\`.
- Never overwrite user notes without draft + confirmation.
`;

const NOTES_IDEA = `# Idea

Compare attention mechanisms across transformer variants and pretraining styles.

Related:

- [[papers/nlp/transformers/1706.03762/NOTES]]
- [[papers/nlp/pretrain/1810.04805/NOTES]]
- [[notes/attention]]
`;

const NOTES_ATTENTION = `# Attention

Core concept shared by Transformers and later LMs.

Papers:

- [[papers/nlp/transformers/1706.03762/NOTES]]
- [[papers/nlp/pretrain/1810.04805/NOTES]]
- [[papers/nlp/pretrain/2005.14165/NOTES]]
`;

const ASSETS_README = `# Assets

Non-paper media for local preview (not catalogued in SQLite):

- \`sample.pdf\` — loose PDF outside \`papers/\`
- \`figures/\` — sample images (png / jpg / gif / webp / svg / bmp / ico)

Paper-unit PDFs live under each paper folder as \`{id}.pdf\`.
`;

// --- Minimal binary fixtures (valid enough for blob: / image viewers) ---

/** Minimal one-page PDF (Helvetica "Demo"). */
function minimalPdf(label = "Demo") {
	const safe = String(label)
		.replace(/[()\\]/g, " ")
		.slice(0, 40);
	const stream = `BT /F1 24 Tf 72 720 Td (${safe}) Tj ET`;
	const objects = [
		"1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
		"2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
		"3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n",
		`4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj\n`,
		"5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
	];
	let body = "%PDF-1.4\n";
	const offsets = [0];
	for (const obj of objects) {
		offsets.push(Buffer.byteLength(body, "utf8"));
		body += obj;
	}
	const xrefStart = Buffer.byteLength(body, "utf8");
	let xref = `xref\n0 ${objects.length + 1}\n`;
	xref += "0000000000 65535 f \n";
	for (let i = 1; i <= objects.length; i++) {
		xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
	}
	body += xref;
	body += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
	body += `startxref\n${xrefStart}\n%%EOF\n`;
	return Buffer.from(body, "utf8");
}

/** 1×1 red PNG. */
const PNG_1X1 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
);

/** 1×1 JPEG. */
const JPEG_1X1 = Buffer.from(
	"/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=",
	"base64",
);

/** 1×1 GIF. */
const GIF_1X1 = Buffer.from(
	"R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
	"base64",
);

/** 1×1 lossy WebP. */
const WEBP_1X1 = Buffer.from(
	"UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=",
	"base64",
);

/** Tiny SVG diagram. */
const SVG_DIAGRAM = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">
  <rect width="240" height="120" fill="#0f172a"/>
  <circle cx="60" cy="60" r="28" fill="#38bdf8"/>
  <rect x="110" y="32" width="96" height="56" rx="8" fill="#a78bfa"/>
  <text x="120" y="66" fill="#f8fafc" font-family="sans-serif" font-size="14">demo</text>
</svg>
`;

/** 1×1 24-bit BMP (blue pixel). */
function minimalBmp() {
	// BITMAPFILEHEADER (14) + BITMAPINFOHEADER (40) + pixel row (4-byte aligned)
	const fileSize = 14 + 40 + 4;
	const buf = Buffer.alloc(fileSize);
	buf.write("BM", 0); // bfType
	buf.writeUInt32LE(fileSize, 2);
	buf.writeUInt32LE(0, 6); // reserved
	buf.writeUInt32LE(54, 10); // pixel offset
	buf.writeUInt32LE(40, 14); // biSize
	buf.writeInt32LE(1, 18); // width
	buf.writeInt32LE(1, 22); // height
	buf.writeUInt16LE(1, 26); // planes
	buf.writeUInt16LE(24, 28); // bpp
	buf.writeUInt32LE(0, 30); // BI_RGB
	buf.writeUInt32LE(4, 34); // image size
	// BGR pixel + pad
	buf[54] = 0xff; // B
	buf[55] = 0x00; // G
	buf[56] = 0x00; // R
	buf[57] = 0x00;
	return buf;
}

/** Minimal 16×16 ICO (1-bit mask + 32bpp XOR via embedded PNG-like raw DIB is heavy; use 1×1 AND/XOR). */
function minimalIco() {
	// ICONDIR + ICONDIRENTRY + 40-byte BITMAPINFOHEADER + 4 BGRA + 4 AND mask
	const headerSize = 6 + 16;
	const dibSize = 40 + 4 + 4;
	const total = headerSize + dibSize;
	const buf = Buffer.alloc(total);
	// ICONDIR
	buf.writeUInt16LE(0, 0);
	buf.writeUInt16LE(1, 2); // icon
	buf.writeUInt16LE(1, 4); // count
	// ICONDIRENTRY
	buf[6] = 1; // width
	buf[7] = 1; // height
	buf[8] = 0; // colors
	buf[9] = 0;
	buf.writeUInt16LE(1, 10); // planes
	buf.writeUInt16LE(32, 12); // bit count
	buf.writeUInt32LE(dibSize, 14);
	buf.writeUInt32LE(headerSize, 18);
	// BITMAPINFOHEADER (height = 2 for XOR+AND)
	const dib = headerSize;
	buf.writeUInt32LE(40, dib);
	buf.writeInt32LE(1, dib + 4);
	buf.writeInt32LE(2, dib + 8);
	buf.writeUInt16LE(1, dib + 12);
	buf.writeUInt16LE(32, dib + 14);
	// XOR: green pixel BGRA
	const px = dib + 40;
	buf[px] = 0x00;
	buf[px + 1] = 0xff;
	buf[px + 2] = 0x00;
	buf[px + 3] = 0xff;
	// AND mask row (4 bytes, zero = opaque)
	return buf;
}

function isoNow() {
	return new Date().toISOString();
}

function demoMeta(paper) {
	return JSON.stringify(
		{
			id: paper.id,
			path: paper.path,
			type: "arxiv",
			title: paper.title,
			authors: paper.authors,
			year: paper.year,
			abstract: paper.abstract,
			tags: paper.tags,
			arxiv_id: paper.id,
			doi: `10.48550/arXiv.${paper.id}`,
			pdf_url: `https://arxiv.org/pdf/${paper.id}`,
			html_url: `https://arxiv.org/html/${paper.id}`,
			source_url: `https://arxiv.org/abs/${paper.id}`,
			body_source: "latex",
			body_quality: "high",
			bibtex_key: paper.bibtex,
			status: "completed",
			summary: paper.abstract.slice(0, 120),
			is_read: Boolean(paper.is_read),
			meta_source: "demo-vault",
			added_at: "2026-07-01T10:00:00.000Z",
			updated_at: isoNow(),
		},
		null,
		2,
	);
}

function sqlQuote(s) {
	return `'${String(s).replaceAll("'", "''")}'`;
}

function buildCatalogSql(papers) {
	const lines = [
		DDL.trim(),
		`INSERT OR REPLACE INTO schema_meta(key, value) VALUES('schema_version', '${SCHEMA_VERSION}');`,
		`INSERT OR REPLACE INTO schema_meta(key, value) VALUES('agentero_app', 'agentero');`,
	];
	for (const p of papers) {
		const added = "2026-07-01T10:00:00.000Z";
		const updated = isoNow();
		const isRead = p.is_read ? 1 : 0;
		lines.push(
			`INSERT OR REPLACE INTO papers(
  path, id, type, title, authors_json, year, abstract, tags_json,
  arxiv_id, doi, pdf_url, html_url, source_url,
  body_source, body_quality, bibtex_key, status, summary,
  creators_json, date, language, meta_source, is_read,
  added_at, updated_at
) VALUES (
  ${sqlQuote(p.path)},
  ${sqlQuote(p.id)},
  'arxiv',
  ${sqlQuote(p.title)},
  ${sqlQuote(JSON.stringify(p.authors))},
  ${p.year},
  ${sqlQuote(p.abstract)},
  ${sqlQuote(JSON.stringify(p.tags))},
  ${sqlQuote(p.id)},
  ${sqlQuote(`10.48550/arXiv.${p.id}`)},
  ${sqlQuote(`https://arxiv.org/pdf/${p.id}`)},
  ${sqlQuote(`https://arxiv.org/html/${p.id}`)},
  ${sqlQuote(`https://arxiv.org/abs/${p.id}`)},
  'latex',
  'high',
  ${sqlQuote(p.bibtex)},
  'completed',
  ${sqlQuote(p.abstract.slice(0, 120))},
  ${sqlQuote(JSON.stringify(p.authors.map((name) => ({ name, creatorType: "author" }))))},
  ${sqlQuote(String(p.year))},
  'en',
  'demo-vault',
  ${isRead},
  ${sqlQuote(added)},
  ${sqlQuote(updated)}
);`,
		);
	}
	return lines.join("\n");
}

function runSqlite(dbPath, sql) {
	execFileSync("sqlite3", [dbPath], {
		input: sql,
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
	});
}

async function writeText(root, rel, content) {
	const full = path.join(root, rel);
	await mkdir(path.dirname(full), { recursive: true });
	await writeFile(full, content, "utf8");
}

async function writeBytes(root, rel, data) {
	const full = path.join(root, rel);
	await mkdir(path.dirname(full), { recursive: true });
	await writeFile(full, data);
}

async function ensureDir(root, rel) {
	await mkdir(path.join(root, rel), { recursive: true });
}

/** Recreate catalog.sqlite from scratch (avoids stale schema on re-run). */
async function writeCatalog(root, papers) {
	const dbPath = path.join(root, ".agentero", "catalog.sqlite");
	await ensureDir(root, ".agentero");
	await rm(dbPath, { force: true });
	// also drop side-car journals if any
	await rm(`${dbPath}-wal`, { force: true });
	await rm(`${dbPath}-shm`, { force: true });
	runSqlite(dbPath, buildCatalogSql(papers));
}

/** Skeleton equivalent to Create Vault (no sample papers / loose media). */
async function scaffoldEmpty(root) {
	for (const d of ["papers", "notes", "assets", ".agentero"]) {
		await ensureDir(root, d);
	}
	await writeText(root, "AGENTS.md", AGENTS_MD);
	await writeCatalog(root, []);
}

/** Loose PDFs + multi-format images (not under papers/). */
async function writeLooseMedia(root) {
	await writeText(root, "assets/README.md", ASSETS_README);
	await writeBytes(root, "assets/sample.pdf", minimalPdf("Loose PDF"));
	await writeBytes(
		root,
		"notes/attachments/reading-list.pdf",
		minimalPdf("Reading List"),
	);

	await writeBytes(root, "assets/figures/red-pixel.png", PNG_1X1);
	await writeBytes(root, "assets/figures/sample.jpg", JPEG_1X1);
	await writeBytes(root, "assets/figures/sample.gif", GIF_1X1);
	await writeBytes(root, "assets/figures/sample.webp", WEBP_1X1);
	await writeText(root, "assets/figures/diagram.svg", SVG_DIAGRAM);
	await writeBytes(root, "assets/figures/sample.bmp", minimalBmp());
	await writeBytes(root, "assets/figures/favicon.ico", minimalIco());
}

/** Full demo with nested papers + notes + loose media + catalog rows. */
async function scaffoldDemo(root) {
	await scaffoldEmpty(root);

	await writeText(root, "notes/idea.md", NOTES_IDEA);
	await writeText(root, "notes/attention.md", NOTES_ATTENTION);
	await writeLooseMedia(root);

	for (const paper of PAPERS) {
		await writeText(root, `${paper.path}/NOTES.md`, paper.notes);
		await writeText(root, `${paper.path}/metadata.json`, demoMeta(paper));
		await ensureDir(root, `${paper.path}/source`);
		await writeText(
			root,
			`${paper.path}/source/.gitkeep`,
			"# Placeholder: original PDF / LaTeX would live here\n",
		);
		// Canonical paper-root PDF (local-first preview path)
		await writeBytes(
			root,
			`${paper.path}/${paper.id}.pdf`,
			minimalPdf(paper.id),
		);
	}

	await writeCatalog(root, PAPERS);
}

async function pathExists(p) {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}

/**
 * Verify vault layout + catalog against current Agentero conventions.
 * @returns {Promise<{ ok: boolean; checks: { name: string; ok: boolean; detail?: string }[] }>}
 */
async function verifyVault(root) {
	const checks = [];
	const needDirs = ["papers", "notes", ".agentero"];
	for (const d of needDirs) {
		const full = path.join(root, d);
		const ok = await pathExists(full);
		checks.push({
			name: `dir ${d}/`,
			ok,
			detail: ok ? full : "missing",
		});
	}

	const agents = path.join(root, "AGENTS.md");
	checks.push({
		name: "AGENTS.md",
		ok: await pathExists(agents),
	});

	const papersMd = path.join(root, "PAPERS.md");
	const bib = path.join(root, "library.bib");
	checks.push({
		name: "no default PAPERS.md",
		ok: !(await pathExists(papersMd)),
		detail: (await pathExists(papersMd))
			? "exists (optional export only)"
			: "absent (ok)",
	});
	checks.push({
		name: "no default library.bib",
		ok: !(await pathExists(bib)),
	});

	const dbPath = path.join(root, ".agentero", "catalog.sqlite");
	const dbOk = await pathExists(dbPath);
	checks.push({ name: "catalog.sqlite", ok: dbOk });

	if (dbOk) {
		try {
			const ver = execFileSync(
				"sqlite3",
				[dbPath, "SELECT value FROM schema_meta WHERE key='schema_version';"],
				{ encoding: "utf8" },
			).trim();
			checks.push({
				name: "schema_version",
				ok: ver === String(SCHEMA_VERSION),
				detail: `got ${ver}, expect ${SCHEMA_VERSION}`,
			});
			const count = execFileSync(
				"sqlite3",
				[dbPath, "SELECT COUNT(*) FROM papers;"],
				{ encoding: "utf8" },
			).trim();
			checks.push({
				name: "papers table readable",
				ok: /^\d+$/.test(count),
				detail: `${count} row(s)`,
			});
			// v3 column must exist
			const hasIsRead = execFileSync(
				"sqlite3",
				[
					dbPath,
					"SELECT COUNT(*) FROM pragma_table_info('papers') WHERE name='is_read';",
				],
				{ encoding: "utf8" },
			).trim();
			checks.push({
				name: "column is_read (v3)",
				ok: hasIsRead === "1",
				detail: hasIsRead === "1" ? "present" : "missing",
			});
			const hasPub = execFileSync(
				"sqlite3",
				[
					dbPath,
					"SELECT COUNT(*) FROM pragma_table_info('papers') WHERE name='publication';",
				],
				{ encoding: "utf8" },
			).trim();
			checks.push({
				name: "column publication (v2)",
				ok: hasPub === "1",
				detail: hasPub === "1" ? "present" : "missing",
			});
			const nested = execFileSync(
				"sqlite3",
				[
					dbPath,
					"SELECT path FROM papers WHERE path LIKE 'papers/%/%' LIMIT 1;",
				],
				{ encoding: "utf8" },
			).trim();
			if (Number(count) > 0) {
				checks.push({
					name: "nested paper path in catalog",
					ok: nested.includes("/"),
					detail: nested || "(none)",
				});
			}
		} catch (e) {
			checks.push({
				name: "catalog query",
				ok: false,
				detail: e instanceof Error ? e.message : String(e),
			});
		}
	}

	// Marker-based paper folders on disk
	const paperDirs = await collectPaperFolders(root);
	checks.push({
		name: "paper folders with NOTES.md",
		ok: paperDirs.length >= 0,
		detail: `${paperDirs.length}: ${paperDirs.slice(0, 3).join(", ")}${paperDirs.length > 3 ? "…" : ""}`,
	});

	// Loose media (demo vault only; empty skeleton may skip)
	if (paperDirs.length > 0) {
		for (const rel of LOOSE_MEDIA.pdfs) {
			const ok = await pathExists(path.join(root, rel));
			checks.push({
				name: `loose PDF ${rel}`,
				ok,
				detail: ok ? "ok" : "missing",
			});
		}
		for (const rel of LOOSE_MEDIA.images) {
			const ok = await pathExists(path.join(root, rel));
			checks.push({
				name: `image ${rel}`,
				ok,
				detail: ok ? "ok" : "missing",
			});
		}
		// At least one paper-root PDF
		const samplePaperPdf = path.join(
			root,
			"papers/nlp/transformers/1706.03762/1706.03762.pdf",
		);
		checks.push({
			name: "paper-root PDF (canonical)",
			ok: await pathExists(samplePaperPdf),
		});
	}

	const ok = checks.every((c) => c.ok);
	return { ok, checks, paperDirs };
}

async function collectPaperFolders(root) {
	const out = [];
	async function walk(dir, rel) {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		const names = new Set(entries.map((e) => e.name.toLowerCase()));
		const isPaper =
			names.has("notes.md") ||
			names.has("metadata.json") ||
			names.has("source") ||
			names.has("marks");
		if (isPaper && rel.startsWith("papers/")) {
			out.push(rel);
			return;
		}
		for (const e of entries) {
			if (!e.isDirectory() || e.name.startsWith(".")) continue;
			const childRel = rel ? `${rel}/${e.name}` : e.name;
			if (childRel === ".agentero") continue;
			await walk(path.join(dir, e.name), childRel);
		}
	}
	await walk(path.join(root, "papers"), "papers");
	return out.sort();
}

function parseArgs(argv) {
	const flags = new Set();
	const positionals = [];
	for (const a of argv) {
		if (a.startsWith("--")) flags.add(a.slice(2));
		else positionals.push(a);
	}
	return { flags, positionals };
}

function defaultDownloadsPath() {
	return path.join(os.homedir(), "Downloads", "agentero-demo-vault");
}

function printHelp() {
	console.log(`Create Agentero demo vault

Usage:
  node test/scripts/create-demo-vault.mjs [options] [path]

Options:
  --downloads   Use ~/Downloads/agentero-demo-vault
  --empty       Skeleton only (Create Vault equivalent)
  --verify      Verify an existing vault (no write unless path missing + create)
  --help        Show this help

Examples:
  node test/scripts/create-demo-vault.mjs --downloads
  node test/scripts/create-demo-vault.mjs --empty ~/Downloads/agentero-empty-vault
  node test/scripts/create-demo-vault.mjs --verify ~/Downloads/agentero-demo-vault
`);
}

async function main() {
	const { flags, positionals } = parseArgs(process.argv.slice(2));
	if (flags.has("help") || flags.has("h")) {
		printHelp();
		process.exit(0);
	}

	let target = positionals[0];
	if (flags.has("downloads")) {
		target = defaultDownloadsPath();
	}
	if (!target) {
		target = path.join(REPO_ROOT, "tmp", "agentero-demo-vault");
	}

	const root = path.resolve(target);

	if (flags.has("verify")) {
		if (!(await pathExists(root))) {
			console.error(`Vault not found: ${root}`);
			process.exit(1);
		}
		const result = await verifyVault(root);
		for (const c of result.checks) {
			const mark = c.ok ? "✓" : "✗";
			console.log(`${mark} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
		}
		console.log(result.ok ? `\nOK: ${root}` : `\nFAILED: ${root}`);
		process.exit(result.ok ? 0 : 1);
	}

	if (flags.has("empty")) {
		await scaffoldEmpty(root);
		console.log(`Empty Agentero vault created at ${root}`);
	} else {
		await scaffoldDemo(root);
		console.log(`Demo Agentero vault created at ${root}`);
		console.log(`  papers: ${PAPERS.length} (nested under papers/<topic>/…)`);
		console.log(
			`  loose PDFs: ${LOOSE_MEDIA.pdfs.length} · images: ${LOOSE_MEDIA.images.length}`,
		);
		console.log(`  catalog schema_version: ${SCHEMA_VERSION}`);
	}

	const result = await verifyVault(root);
	for (const c of result.checks) {
		const mark = c.ok ? "✓" : "✗";
		console.log(`${mark} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
	}
	if (!result.ok) {
		console.error("Verification failed");
		process.exit(1);
	}
	console.log("\nOpen in Agentero: File → Open Vault… → select this folder");
	console.log(`  ${root}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
