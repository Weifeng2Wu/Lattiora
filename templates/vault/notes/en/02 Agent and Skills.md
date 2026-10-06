# Agent & Skills

Lattiora uses one built-in Agent. Configure **provider**, **base URL**, **API key** and **model** in Settings → Agent, then test the connection. Anthropic and OpenAI-compatible services are supported. Keys are encrypted on the Worker; model usage is billed by your provider.

## Agent Panel

Click the sidebar button in the top-right corner to open the **Agent** panel (`⌘+L`).

When a paper is open, it is added to the Agent context automatically. You can:

- Type a question directly.
- Use `@` to mention any path in the Vault.
- Use `$` to select a Skill or `/` for workflow commands.
- Drag a file or folder from the file tree into the composer as context.
- Select text or annotations in the PDF and send them to the Agent.

You can keep typing while the Agent is responding. Later messages are queued and sent automatically after the current response finishes.

## Skills

### Using Skills

Use `$` to select a Skill; `/` opens workflow and slash commands.

### Editing a Skill

Edit the corresponding `SKILL.md` directly.

### Adding a Skill

Create a new folder under `.agents/skills/` and add a `SKILL.md` file.

Use the Skills import panel for a public GitHub source, or upload a SKILL.md / ZIP package. Imported files are available offline and included in sync and backup.

### Bundled Skills

Bundled Skills include:

- `paper-reader` — deep-read a paper and write `NOTES.md`.
- `agentero-workspace` — use the built-in document and research tools.
- `vault-normalizer` — reorganize an existing research directory into the Lattiora Vault layout.
- `deep-research` — conduct multi-step research with citations.
- `idea-evaluator` — evaluate research ideas from multiple perspectives.

### Example: Reading a Paper

The paper must have a local PDF and readable text, either TeX or `PAPER.md`:

- **Manual reading**: click the **read icon** on an unread paper row.
- **Automatic reading**: enable **autoPaperReader** under Settings → Agent. It is disabled by default.

The reading result is written to the paper's `NOTES.md`, and the paper is marked as read when the workflow finishes.

## Settings

### Model configuration and troubleshooting

1. Open **Settings** → **Agent**.
2. Enter your service protocol, base URL, API key and model.
3. Click the connection-test button before starting a conversation.

If a request fails, check the model name, endpoint, provider balance and the reported error. Local ACP executables are not used in the web application.

## Next

- [[01 Papers and Import]]
- [[03 Markdown and Wikilinks]]
