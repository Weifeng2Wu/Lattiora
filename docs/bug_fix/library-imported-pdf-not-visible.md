# 本地 PDF 导入后 Library 中看不到

**影响面**：Library 表格，本地 PDF 拖入/魔棒导入后的可见性与搜索。

## 现象

本地 PDF 导入已经写入 Vault 与 `.agentero/catalog.sqlite`，但用户在 Library 中看不到对应论文。
在实际排查的 vault `/Users/philfan/l/test` 中，
`papers/10_3389_fpls_2025_1611992` 的 catalog 行存在且状态为 `completed`：

- `path = papers/10_3389_fpls_2025_1611992`
- `id = 10_3389_fpls_2025_1611992`
- `doi = 10.3389/fpls.2025.1611992`

但在 Library 搜索 `10_3389_fpls_2025_1611992` 或 DOI 时找不到。

## 原因

这里有两个问题叠加：

1. Library 表头搜索只匹配 `title` 和可见 tags，不匹配 `id`、`path`、DOI、arXiv、作者、期刊等字段。导入后的论文若用户按文件夹名、文件名 slug 或 DOI 搜索，会返回空结果，看起来像未入库。
2. 本地 PDF 导入 job 成功后主要依赖 Host 的 `paper:imported` lifecycle 事件触发 Library 刷新。事件正常时可用，但前端成功路径没有主动刷新兜底，批量拖入/后台识别/事件延迟时容易短时间停留在旧列表。

## 修复

- `buildPaperRow` 新增 `searchText`，把标题、catalog id、展示 identifier、path、DOI、arXiv、PMID、ISBN、publication、publisher、authors 和可见 tags 统一纳入搜索索引。
- `PapersLibrary` 搜索改为匹配 `row.searchText`，不再只查 title/tag。
- `runLocalPdfImportJob` 在 Host 返回导入结果且任务未取消后主动 `refreshLibrary()`，保留 lifecycle 事件刷新作为并行兜底。
- 更新 Library 搜索文案（en / zh-CN）。

## 验证

```bash
sqlite3 /Users/philfan/l/test/.agentero/catalog.sqlite \
  "select path,id,title,doi,status from papers where id like '%1611992%';"
pnpm exec vitest run test/publication-date.test.ts
pnpm exec biome check src/components/library/library-row-utils.ts src/components/library/papers-library.tsx src/lib/paper/import-actions.ts src/i18n/locales/en/sidebar.json src/i18n/locales/zh-CN/sidebar.json test/publication-date.test.ts
```

Roadmap 与 TODO 已检查：这是已实现 Library / 本地 PDF 导入能力的缺陷修复，不新增未完成产品项。
