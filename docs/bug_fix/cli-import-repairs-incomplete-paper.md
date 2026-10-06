# CLI 导入修复残缺论文单元

**影响面**：`agentero import id` / Bib/RIS 导入复用的 `paper_commit` 去重链路。

## 问题

当 Catalog 中已经存在同 `id` 或同 DOI/arXiv/PMID/ISBN 的残缺行时，导入会在 dedupe 阶段提前返回。这个路径不会再执行 shell 初始化与 Catalog upsert，因此旧的半成品状态会保留下来：

- 论文目录可能不存在，或目录下缺少 `NOTES.md`。
- 新解析出的 title、authors、year、abstract、identifier、URL 等 metadata 不会回填到 Catalog。

典型表现是 CLI 提示已导入或去重，但 `paper list/get` 仍读到空/旧 metadata，文件树下也没有可编辑的 `NOTES.md`。

## 修复

`paper_commit` 的 `ByCatalogId` 与 `ByIdentifiers` dedupe 分支在返回既有记录前会执行轻量修复：

- 创建缺失的论文目录。
- 只用新解析结果回填既有记录的空字段，不覆盖用户已有 metadata。
- 如果 `NOTES.md` 缺失，按当前 `NoteShellMode` 写入标准 shell。
- 有变更时重新 upsert Catalog，并使 caps cache 失效。

本地 PDF 的 dedupe merge 路径仍保持原语义：只合并 PDF 与缺失 identifier，不重写已有笔记。

## 验证

- `cargo test -p agentero-core features::paper::import::paper_import::tests::by_identifiers_repairs_incomplete_existing_entry`

