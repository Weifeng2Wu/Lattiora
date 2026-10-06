# Papers & Import

## Creating a Paper Library

## Import Methods

Lattiora supports several ways to import papers into your Vault.

### Magic Wand

1. Click the magic-wand button in the sidebar.
2. Paste a link into the input field. Lattiora downloads metadata and the PDF into a new paper folder.
   - arXiv IDs
   - DOIs
   - Scholarly URLs containing these identifiers

### Zotero export

Export your Zotero library as BibTeX, RIS or JSON and use **Import** in the workspace toolbar. The browser application cannot replace Zotero's localhost Connector listener.

### Website sources

Paste a public article URL into the Magic Wand to import its metadata and readable body. arXiv IDs and DOIs use their scholarly metadata services. HTML sources can be read and cached in the HTML view. Login-only and client-rendered pages may not expose article content. Subscription articles can also be imported from Feeds.

### Local PDF

Drag a PDF into the file tree, or use the import command to create a paper folder from a local file.

## Library

The Library table shows all papers in the catalog. You can:

- Sort by clicking column headers.
- Right-click a header to choose visible columns and reorder them.
- Filter by tags or search title, author, abstract, and tag substrings.
- Use **Rescan** to discover paper folders that exist on disk but are missing from the catalog.

### Adding Tags

Add or remove tags in the **Info** panel at the bottom left. Tags are stored in the paper’s `.paper.json` metadata and shown as colored chips in the Library.

## Next

- [[02 Agent and Skills]]
- [[03 Markdown and Wikilinks]]
