# 阅读标注：即时文字定位（标的时候算）

> 状态：设计草案。关联 [\#170](https://github.com/poco-ai/Agentero/issues/170)。  
> 姊妹篇：[惰性定位](mark-locate-lazy.md) · [开发路线](mark-cli-roadmap.md)

## 1. 一句话

在 **创建 / 更新 mark 的当时** 就调用定位后端，把 `page` + `rects` 写进 JSON，尽量一次落成 `geometry=resolved`。

```text
Agent/CLI/UI 请求 mark add(quote, …)
        ↓
定位后端（阅读器已打开的 doc，或 Host headless 搜 PDF）
        ↓
search(quote) → page + rects
        ↓
一次写入 mark(geometry=resolved)
```

## 2. 背景与动机

- 用户希望：**Agent 说「标好了」时，打开 PDF 立刻有框**，不必等 hydrate。
- 当 **这篇 PDF 已在阅读器打开** 时，文档已在内存，即时搜索 **成本低、与所见一致**。
- 与 [惰性定位](mark-locate-lazy.md) **互补**：惰性是默认与 CLI 主路径；即时是「有条件时的加速」和可选 headless。

## 3. 两种即时后端

| 后端 | 条件 | 引擎 | 与屏幕一致性 |
|---|---|---|---|
| **B1 · Viewer 即时** | 目标 PDF 的 tab/doc 已加载 | EmbedPDF `searchAllPages` | 高（同一引擎） |
| **B2 · Headless 即时** | 有本地 PDF 路径；不依赖 GUI | Host/liteparse-pdfium 或等价文本层搜索 | 需与前端坐标约定对齐，可能有细微差 |

**推荐落地顺序：先 B1，再视需要 B2。**  
B2 不是 #170 首版必需；没有 B2 时，CLI 冷写仍走惰性 pending。

## 4. 范围

### 要做（B1）

- 写 mark 的路径可查询：「`paperPath` 是否有活跃 PDF viewer + doc ready」。
- 若有：同步或短异步 `searchAllPages`，成功则直接 `resolved` 落盘。
- 若无 / 失败：降级为 `pending` 或 `failed`（**不要**让整次 Agent 回合硬失败，除非调用方要求严格）。
- 与惰性 schema 共用同一套 `geometry` / `rects` 字段。

### 要做（B2，后置）

- Host 或 CLI：`mark add --resolve` / `pdf locate-quote` 一类显式接口。
- 打开 PDF 字节 → 文本层匹配 → 归一化 rects（与 viewer 同一 0–1 约定）。
- 超时、页数上限、内存峰值策略。

### 不做

- 默认让每一次 CLI `mark add` 都冷启动扒 PDF（默认应保持轻量）。
- Agent 进程内嵌 EmbedPDF。
- 用语义向量检索代替精确字符串定位。
- 图/公式自动 bbox（非本篇；见路线图上层能力）。

## 5. 决策树（产品默认）

```text
请求创建 mark(quote, …)
    │
    ├─ 调用方强制 --no-resolve？ → 只写 pending
    │
    ├─ 目标 PDF 在桌面已打开且 doc ready？
    │     是 → B1 搜索
    │           ├─ 成功 → resolved 落盘
    │           └─ 失败 → failed 或 pending（可配置）
    │
    ├─ 调用方显式 --resolve 且 Host 支持 B2？
    │     是 → headless 搜索（同上成功/失败）
    │
    └─ 否则 → pending 落盘（走惰性）
```

**默认策略：能即时则即时，否则 pending。**  
禁止：无打开文档且无 `--resolve` 时仍偷偷全库扫 PDF。

## 6. 数据契约

与 [惰性篇 §4](mark-locate-lazy.md) **同一 schema**。  
即时成功时示例：

```json
{
  "version": 1,
  "kind": "highlight",
  "id": "…",
  "paperPath": "papers/…",
  "quote": "Attention is all you need",
  "page": 3,
  "rects": [{ "x": 0.12, "y": 0.34, "w": 0.55, "h": 0.02 }],
  "geometry": "resolved",
  "resolve": {
    "strategy": "search",
    "backend": "viewer",
    "matchIndex": 0
  }
}
```

`resolve.backend`: `viewer` | `headless` | `lazy-hydrate`，便于调试与双后端对齐测试。

## 7. 调用面

### 7.1 桌面（B1）

| 入口 | 行为 |
|---|---|
| UI 内部「从 Agent 结果一键高亮」 | 优先 B1 |
| 前端在收到 mark 写入意图时 | 若当前 tab 即该 PDF → B1 |
| 仅文件监听发现新 mark | **不**在监听路径做重搜索（避免与惰性抢；或仅补 pending） |

注意：Agent 经 ACP 改 Vault 文件时，若 PDF 已打开，可由 **viewer 订阅 marks 变更** 触发 B1 或惰性 hydrate（实现选一种，避免双重搜索）。

### 7.2 CLI（B2 可选）

```bash
# 默认：轻量 pending（推荐）
agentero mark add <paper> --kind highlight --quote "…" --json

# 显式付费：当场 headless 定位（B2 落地后）
agentero mark add <paper> --kind highlight --quote "…" --resolve --json
```

`--resolve` 失败时：`--json` 返回 `geometry` 与错误码；退出码策略需在实现时定（建议：定位失败仍 ok 写盘 + `geometry=failed`，或严格模式非零）。

## 8. 性能与消耗

| 场景 | 即时 B1（PDF 已开） | 即时 B2（冷 headless） | 惰性 |
|---|---|---|---|
| 单次标注延迟 | 低（内存内搜索） | 高（读 PDF + 搜） | 写 JSON 极低 |
| Agent 连标 20 句（PDF 已开） | 中（可 batch 一次加载多次搜） | 很高 | 很低 |
| 打开 PDF 时 | 无 pending 则最轻 | 同左 | 有 pending 则补搜 |
| 内存峰值 | 与阅读共享 | 可能额外一份 PDF | 标注阶段无 PDF |
| Agent 体感 | 需异步，避免堵死流式输出 | 更易卡住 | 最流畅 |

**结论（消耗）：**

- B1 在「边读边标」时性价比最高。  
- B2 适合批处理、CI、明确 `--resolve`；**不应做默认**。  
- 纯即时、且总冷启动 = 最耗；产品上避免。

## 9. 与惰性的协作

| 原则 | 说明 |
|---|---|
| 同一 schema | 两种路径写同一种 mark |
| 不重复搜 | `resolved` 打开时跳过；`pending` 才 hydrate |
| 失败可升级 | `failed` 可提供「重试定位」（再走 B1 或打开时惰性） |
| 后端标记 | `resolve.backend` 便于对比 viewer vs headless 偏差 |

推荐产品句式：

> 默认惰性；阅读中标注尽量即时；CLI 要坐标时显式 `--resolve`。

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Agent 回合被搜索拖慢 | B1/B2 均异步；先回「已记录」，再补 resolved 事件（若需） |
| 双重 hydrate 打架 | 单 flight lock per paperPath |
| B2 与 B1 坐标不一致 | 共享归一化约定 + 黄金样例 PDF 测试 |
| 远程 Vault | 首版可禁用 B2；B1 仅本地打开的副本 |
| 严格模式误伤 | 默认定位失败仍保留批注内容 |

## 11. 验收要点

### B1

- [ ] PDF 打开时，从 UI/Agent 触发的 mark add 能一次得到 `resolved` 与正确针位。
- [ ] PDF 未打开时，同一操作得到 `pending`，不报致命错误。
- [ ] 不阻塞 Agent 流式输出（或可接受的明确 loading 状态）。

### B2（若做）

- [ ] `mark add --resolve` 在无 GUI 下可产出 rects。
- [ ] 默认无 `--resolve` 不读 PDF。
- [ ] 大 PDF 有超时与错误码。

## 12. 代码触点（实现时）

| 区域 | 说明 |
|---|---|
| viewer 活跃 doc 注册表 | 「paperPath → docId」查询 |
| mark 写入门面 | 决策树：B1 / B2 / pending |
| `src-tauri` features（B2） | headless locate API |
| `cli` mark 子命令 | `--resolve` 开关 |
| 与惰性 hydrate | 共用 match 策略模块 |

## 13. 相关文档

- [惰性定位](mark-locate-lazy.md)
- [开发路线：基础 / 上层 / Skill · CLI 内置命令面](mark-cli-roadmap.md)
- [内置桌面 CLI 分发](../backend/cli.md)
- [PDF 阅读与划词](../frontend/pdf.md)
- [CLI](../backend/cli.md)
