---
name: agentero-workspace
version: 2
description: Inspect papers, find evidence and manage research notes with the built-in Lattiora browser tools.
---

# Lattiora Workspace

This replaces the desktop `agentero-cli` skill's execution interface. It does not invoke a CLI or another agent.

1. Discover files with `list_files`. Read paper metadata at `papers/<id>/.paper.json` and the paper folder using `read_document`. Follow `truncated`/`nextStart` to cover the complete source.
2. Read selected Skill references through their full `.agents/skills/<id>/...` paths. They are available offline along with the installed application.
3. Search cached text using `search_documents`. This is not an internet search and does not imply uncached PDFs were indexed.
4. Ground claims in the returned evidence. Cite existing PDF page links and notes; never invent references or successful actions.
5. Create a note with `write_note`, `expectedText: null`. To change a note, read the exact current content first and supply it as `expectedText`. A rejected permission or version conflict means no write occurred.
6. Use `update_plan` to expose task progress and `ask_user` for missing requirements.
7. Imports, paper metadata, tags, read status, parsing and link diagnostics are available through the paper-library, import and Doctor interfaces. When no corresponding tool is exposed, direct the user to that action and do not claim to have performed it.

There are no operating-system commands, SSH sessions, local ACP agents or script execution. API-backed services use only the owner's settings. LaTeX and drawing source can be prepared as text and exported for external compilation where required.
