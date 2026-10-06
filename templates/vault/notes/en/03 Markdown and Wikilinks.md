# Markdown & Wikilinks

Lattiora notes are plain Markdown files. You can edit them inside the app or with any external editor.

## Basic Markdown

```markdown
# Heading 1

## Heading 2

- bullet
- another bullet

1. numbered
2. numbered

**bold**, *italic*, `inline code`
```

```rust
// code block
// Click the top-right button to switch language or copy code
```

> [!NOTE]
> Obsidian-style callouts are supported.

Callouts render with icons and theme colors. Click the title or icon to edit the type and title inline. Supported types include `note`, `tip`, `info`, `warning`, `danger`, `success`, `question`, `quote`, `example`, and `failure`.

## Math

Inline math: `$E=mc^2$`

Block math:

```markdown
$$\int_a^b f(x) dx$$
```

> [!TIP]
> Typing `\$a\$` keeps it as plain text; `$a$` is rendered as math.

## Slash Commands

Type `/` in the editor to open a lightweight command menu. Use the arrow keys to navigate and `Enter` to insert. Commands include headings, lists, todos, quotes, code blocks, diagrams, links, and callouts.

Common commands:

| Command        | Inserts                                        |
| -------------- | ---------------------------------------------- |
| `/mermaid`     | A live-rendered Mermaid diagram                |
| `/code`        | A code block (pick a language from the selector) |
| `/callout`     | An Obsidian callout (`note` type by default)   |
| `/link`        | An internal wikilink `[[]]`                    |
| `/heading 1–3` | A heading block                                |

> [!NOTE]
> `/` must be at the start of a line or after a space. It does not trigger inside code blocks or when a wikilink completion menu is open.

## External links

Standard Markdown links work in the editor:

```markdown
[Lattiora site](https://github.com/Weifeng2Wu/Lattiora)
```

Type the full `[label](url)` form (the closing `)` turns it into a link), paste the same syntax, or use the context menu / slash command **Add external link** — that inserts a link node with a placeholder label and opens the edit bubble for display text and URL. Click an existing link to edit; **⌘/Ctrl+click**, middle-click, or right-click opens it in your system browser. Relative links to other vault notes use in-app navigation instead.

## Mermaid Diagrams

Use `/mermaid` or select **Mermaid** from a code block's language selector. The diagram preview appears below the source code:

```mermaid
graph LR
    A[Paper] --> B[Read]
    B --> C[Notes]
    C --> D[Next Steps]
```

> [!TIP]
> Mermaid diagrams are read-only previews. Edit the source code above to update the diagram.

## Wikilinks

Link to another note with double brackets:

```markdown
[[01 Papers and Import]]
```

Link to a heading inside a note:

```markdown
[[01 Papers and Import#Library]]
```

Nested headings use the full path:

```markdown
[[01 Papers and Import#Import Methods#Zotero Connector]]
```

Use `@` for PDF highlights and visual annotations. Copy the `id` from the Annotations panel, or type `[[@` to open completion:

```markdown
[[@annotationId]]
[[papers/…/NOTES@annotationId|Paper title]]
```

- `#` heading · `^` text block · `|` display name · `@` annotation; press `tab` to complete and `enter` to confirm.
- Annotation targets must use a path (`NOTES`, `paper.pdf`, or `papers/…/NOTES`), not only the paper's display title.

Lattiora indexes all `[[...]]` links for the **Backlinks** panel and **Graph** view.

## Embeds

Prefix a wikilink with `!` to embed its content as a read-only block:

```markdown
![[01 Papers and Import#Library]]
![[papers/…/NOTES@annotationId]]
```

You can embed:

- **Note sections** — any heading path: `![[note#Section#Subsection]]`
- **Images** — `![[diagram.png]]` or `![](./assets/diagram.png)`
- **PDF pages** — `![[paper.pdf]]`
- **PDF annotations** — `![[…@annotationId]]`

Embedded content stays in sync with the source. Editing the original file updates all embeds automatically. The embed itself is read-only; edit the source file to change it.

## Images

Paste an image into a Markdown note and Lattiora stores it under the note's `assets/` folder:

```markdown
![diagram](./assets/diagram.png)
```

If an image is no longer referenced, it is cleaned up automatically.

## Next

- [[02 Agent and Skills]]
- [[01 Papers and Import]]
