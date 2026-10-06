## Wikilink policy

使用 wikilinks 连接 vault 中已经存在的知识。链接是可导航关系，
不是给每个技术词加装饰。

- 添加链接前，用 `agentero paper list --json` 或直接检查 Vault 文件，确认目标存在。
- 链接 catalog 中的论文时，使用 canonical Vault-relative target，
  例如 `[[papers/nlp/1706.03762/NOTES|Attention Is All You Need]]`。
- 链接已有概念笔记时使用路径，例如
  `[[notes/attention-mechanism|attention mechanism]]`。
- 如果某个概念没有对应 note，就保留为普通文本。只有用户明确要求额外交付时，才创建概念 note。
- 对 heading links，优先使用完整 canonical heading path
  （`[[notes/topic#Outer#Inner|label]]`），避免重复子标题导致歧义。
- 引用 `{paper}/marks/` 中已经存在的 **PDF highlight 或 visual mark** 时，使用带真实 id 的
  annotation wikilink（id 来自磁盘或 UI copy action），例如
  `[[papers/.../NOTES@<id>|short label]]` 或 `![[papers/.../NOTES@<id>]]`。
  - 优先使用 vault-relative path target（`NOTES` / `papers/.../NOTES` / `*.pdf`），
    不要只用论文展示标题作为目标。
  - 不要编造 mark id。如果没有读取 `marks/`，就把相关论述写成普通文本。
- 保留用户已有 wikilinks。除非用户另行批准更大范围清理，否则只修复本次引入或修改的链接。