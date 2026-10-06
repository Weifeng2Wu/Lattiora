# AGENTS.md

<!-- template-version: 3; Cloudflare web vault -->

This file is the L0 map for agents working in this Lattiora research vault.

## Layout

- `papers/` — paper folders (any depth). A **paper folder** is the minimal unit:

```text
papers/<id>/
├── NOTES.md          # human / agent working notes
├── .paper.json       # synchronized paper metadata (do not invent by hand)
├── <id>.pdf          # optional main PDF
├── PAPER.md          # derived body when no TeX (regenerable)
├── source/           # TeX / e-print (do not dump extras here)
├── marks/            # reading annotations (use the reader UI, not hand-edits)
├── assets/           # images embedded from NOTES.md
└── attachments/      # supporting materials only (supplements, slides, code)
```

  Create `attachments/` only when adding files. Do not put extras at the paper
  root or into `source/`. Do not invent empty `attachments/` folders.

- `notes/` — free-form concept notes (`[[wikilinks]]`, embeds, Mermaid, callouts).
- `data/` — imported datasets and artifacts; keep them out of `papers/`.
- `thesis/` — LaTeX manuscript workspace; `thesis/main.tex` is a minimal starter.
- `.agents/` — vault-local skills (`skills/<id>/SKILL.md`).

## Paper reading order

For a paper folder, use the richest available source in this order:

1. `source/**/*.{tex,ltx}` — prefer for structure, equations, citations, experiments
2. `{paper}/source/parsed.md` or `{paper}/PAPER.md` — cached derived text
3. If neither exists, use `read_document` on the PDF for browser text extraction. Scans require a configured parser in the reader; explain this if extraction fails.
4. Do not claim to have read images or complete documents from truncated text. There is no local parser binary or shell.

- `NOTES.md` is the user's working note, not the paper body. Read it for context;
- preserve user-written content; never treat it as a substitute for the source
- When the user already gives a paper path, start from that folder (NOTES → body).Do not list the whole catalog first

## Chat rules

- Math (KaTeX): inline `$…$`, display `$$…$$` on their own lines; prefer `$`/`$$`
  over `\(...\)` / bare TeX in prose; escape a literal dollar as `\$`.
  - DO NOT USE custom `\b`-prefixed macros (e.g., `\bx`, `\bmu`); Use standard `\boldsymbol{...}` / `\mathbf{...}` instead.
- Use the exposed browser tools for reading and note changes. `write_note` requires the exact original text and respects the configured permission mode. Structured import/move/parse/marks/tags operations use the corresponding application UI; do not invent tool support. See `$agentero-workspace` for current tools and limits. No CLI, shell, SSH or external agent process is available.
- Cite sources inline **without wrapping parentheses**. citation **hrefs should target the local PDF**
  `[Section 2.3](papers/<id>/<id>.pdf#section=2.3)`,
  `[Figure 1](papers/<id>/<id>.pdf#figure=1)`,
  `[p.11](papers/<id>/<id>.pdf#page=11)`,
  or notes `[[papers/<id>/NOTES]]` / `[[papers/<id>/NOTES|short title]]`.For web pages use `[domain](https://...)`.

## Rules

- Do not invent facts, numbers, citations, or experimental conclusions. Mark uncertainty.
- Keep `[[wikilinks]]` and `![[embeds]]` as written; preserve ` ```mermaid ` fences.
- Never overwrite user notes without an explicit draft + confirmation path.
