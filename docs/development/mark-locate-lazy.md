# 阅读标注：惰性文字定位（打开再算）

> 状态：设计草案。关联 [\#170](https://github.com/poco-ai/Agentero/issues/170)。  
> 姊妹篇：[即时定位](mark-locate-eager.md) · [开发路线](mark-cli-roadmap.md)

## 1. 一句话

Agent / CLI **先只写下要标的句子（与备注）**；**用户打开该 PDF 时**，再用阅读引擎（EmbedPDF + PDFium）搜索句子，补全页码与高亮矩形。

```text
写 mark(quote, comment, geometry=pending)
        ↓
用户打开 papers/…/*.pdf
        ↓
searchAllPages(quote) → page + rects
        ↓
写回 mark(geometry=resolved) → 页边针 / 可选黄底
```

## 2. 背景与动机

- 划词高亮依赖 **页码 + 归一化 rects（0–1）**；Agent 通常只有 **quote 文本**，不应编造坐标。
- 全文搜索与 `SearchResult.rects` **已在阅读器内存在**（⌘F），缺的是接到 `marks/` 的 hydrate 管线。
- CLI **不运行** EmbedPDF；定位应发生在 **文档已加载的阅读会话**，与 headless CLI 边界一致。
- 写标注是高频、应极轻的操作；打开 PDF 的 I/O 用户本来就会付——定位叠在打开上更省。

与 [即时定位](mark-locate-eager.md) 对比：惰性是 **默认主路径**；即时是 PDF 已打开时的加速，不是替代。

## 3. 范围

### 要做

- mark schema 支持 `geometry: pending | resolved | failed`（命名以实现为准）。
- `pending` 时 `quote` 必填；`rects` 可空；可选 `page` 作为搜索提示。
- PDF viewer 在文档 ready 后，对本 paper 的 pending marks 批量定位并写回 Vault。
- 多命中 / 零命中策略与可观测结果（失败不丢句子与备注）。
- 定位成功后至少支持：跳页、页边针、批注列表；黄底同步 EmbedPDF 可二期。

### 不做（本篇）

- Host/CLI headless 搜 PDF（属即时/可选路径，见姊妹篇与路线图）。
- 图/公式自动区域检测；扫描版 OCR 定位保证。
- CLI 内 BYOA / 跑 Agent。
- 改写 PDF 二进制；强制把 marks 刷进 `NOTES.md`。

## 4. 数据契约（草案）

落盘仍在 `papers/<id>/marks/`（见 [data-model](../backend/data-model.md)）。  
惰性路径主要扩展 **per-id** `marks/<id>.json`（勿直接手写 EmbedPDF `annotations.json` blob）。

```json
{
  "version": 1,
  "kind": "highlight",
  "id": "…",
  "paperPath": "papers/…",
  "createdAt": "…",
  "updatedAt": "…",
  "quote": "Attention is all you need",
  "page": 3,
  "rects": [],
  "color": "yellow",
  "comment": "核心贡献",
  "geometry": "pending",
  "resolve": {
    "strategy": "search",
    "matchIndex": 0,
    "lastError": null
  }
}
```

| 字段 | 说明 |
|---|---|
| `geometry` | `pending`：待搜；`resolved`：已有可用 rects；`failed`：搜过失败 |
| `quote` | 定位主键；过短应在写入或 resolve 时拒绝/警告 |
| `page` | 可选 1-based 提示；多命中时优先该页 |
| `rects` | 与现有划词一致：页内 0–1；`pending` 可为空数组 |
| `resolve` | 可选诊断：策略、选用第几个命中、错误信息 |

`kind` 可为 `highlight` / 带 `comment` 的批注 / `translate` 等；**只要依赖页上框，都可走同一套 geometry。**

与现有 runtime 高亮双轨：

- **权威语义 mark**：per-id JSON（CLI / Agent / 双链 `@id`）。
- **页上黄底**：仍可由 EmbedPDF `marks/annotations.json` 表达；hydrate 成功后 **可选投影**，首版可不投影。

## 5. 运行时流程

### 5.1 触发时机

在 **该 PDF 的 EmbedPDF document 已可用** 之后：

1. 列出该 paper 下 `geometry === pending`（或无 rects 且有 quote）的 marks。
2. 对每条（或去重后的 quote）调用搜索能力。
3. 写回磁盘；更新内存 store / 针 / 列表。
4. 切换 tab、Vault 切换时取消或忽略过期任务。

建议：

- 同一 `docId` 一轮 hydrate **串行或有限并发**，避免拖死主线程。
- 相同 `quote` 可缓存本轮搜索结果。
- 用户快速关闭 PDF：已写回的保留；未完成的下次再试。

### 5.2 搜索与坐标

复用现有能力（概念对应，非最终函数名）：

| 步骤 | 能力 |
|---|---|
| 搜全文 | `search.searchAllPages(quote)` 或 engine `searchAllPages` |
| 命中几何 | `SearchResult.pageIndex` + `SearchResult.rects`（页内点） |
| 归一化 | 与 `anchorFromEmbedSelection` 相同：÷ page width/height → 0–1 |
| 页码 | `pageIndex + 1` |

### 5.3 命中策略

| 情况 | 行为 |
|---|---|
| 1 个命中 | 采用；`geometry=resolved` |
| 多个命中且有 `page` | 过滤到该页；仍多个则取 `matchIndex`（默认 0） |
| 多个命中且无 `page` | 取第一个；可选 UI 以后做「换一个命中」 |
| 0 个命中 | `geometry=failed`；保留 quote/comment；可记 `lastError` |
| quote 空白或过短 | 不搜索；直接 failed 或写入时拒绝 |

文本归一化（建议最小集）：压缩空白、可选大小写不敏感；连字符/断行增强可后置。

### 5.4 显示

| 阶段 | UI |
|---|---|
| pending | 侧栏可见「待定位」；可不画页内色块 |
| resolved | 页边针 + 跳页；可选 EmbedPDF HIGHLIGHT |
| failed | 侧栏可见句子+备注；提示无法定位（Toast 勿刷屏，宜静默或汇总） |

## 6. 与 CLI / Agent 的边界

| 角色 | 惰性路径下的职责 |
|---|---|
| CLI `mark add` | 写 `geometry=pending` + quote；**不**调 EmbedPDF |
| Skill | 教 Agent 写 quote/page/comment，禁止编 rects |
| Viewer | **唯一**默认定位执行点 |
| liteparse / `PAPER.md` | 只供 Agent **读正文**；**不**提供页上框 |

## 7. 性能与消耗

| 项 | 表现 |
|---|---|
| 写 mark | 仅 JSON I/O，极轻 |
| 打开 PDF | 额外 N 次搜索（N=pending 数）；文档已在内存时相对便宜 |
| 批量 Agent 标注且未开 PDF | **不**触发 PDF 解析，适合脚本 |
| 内存 | 不因标注单独常驻 PDF |

适合作为默认：把 PDF 成本叠在用户打开阅读时。

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 打开时卡顿 | 限流、quote 去重、idle 时 hydrate |
| 搜不到 | failed 降级，不丢批注内容 |
| 与人手划词双轨 | 首版针/列表；二期再投影 annotations.json |
| PDF 文件被替换 | 可选 fingerprint；失效后重新 pending |
| 扫描版 | 与划词相同限制；文档中说明 |

## 9. 验收要点

- [ ] 仅含 quote 的 mark 可落盘且 `geometry=pending`。
- [ ] 打开对应 PDF 后，可复制文字层上的句子能变为 `resolved` 并跳页/出针。
- [ ] 故意错误 quote → `failed`，备注仍在。
- [ ] 关闭再开：已 resolved 不再重复搜索（除非强制）。
- [ ] CLI 写入的 pending 与桌面写入同一套 schema。

## 10. 代码触点（实现时）

| 区域 | 说明 |
|---|---|
| `src/lib/pdf/**` schema / marks-io | geometry 字段与校验 |
| `src/components/viewer/embed/pdf-viewer.tsx` | doc ready 后 hydrate |
| `@embedpdf/plugin-search` / engine | `searchAllPages` |
| `src/components/viewer/embed/selection-anchor.ts` | 坐标归一化可复用思路 |
| `cli/` + skill | 只写 pending（见 [路线图](mark-cli-roadmap.md)） |

## 11. 相关文档

- [即时定位](mark-locate-eager.md)
- [开发路线：基础 / 上层 / Skill · CLI 内置命令面](mark-cli-roadmap.md)
- [内置桌面 CLI 分发](../backend/cli.md)
- [PDF 阅读与划词](../frontend/pdf.md)
- [Vault 数据模型 · marks](../backend/data-model.md)
- [CLI](../backend/cli.md)
