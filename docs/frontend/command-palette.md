# 命令面板 / 快速打开

| 快捷键 | 模式 |
|---|---|
| `⌘P` | 快速打开：论文 + `vault_search` 全文 |
| `⇧⌘P` 或输入 `>` | 执行内置命令 |

- 居中浮层；`Esc` / `⌘W` / 同键再按关闭（`overlay-stack`）。
- 命中论文 → 打开该 paper；命中路径 → 打开对应文档。
- 实现：`src/components/dialogs/command-palette.tsx`、`src/lib/vault/search.ts`、`src/lib/shell/commands/`
- Host：`vault_search`（见 [../backend/search.md](../backend/search.md)）
