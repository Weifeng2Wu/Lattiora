# DeepSeek 正文落入 Thinking 区块

**状态**：已修复（前端流解析 + 完成时兜底）  
**影响面**：Agent 对话面板（ACP 流式 UI）  
**相关代码**：

- `src/lib/agent/stream-parse.ts` — 标签拆分与 orphan thought 提升
- `src/components/agent/use-agent-panel.ts` — 流式接入与 turn 完成处理
- `test/agent-stream-parse.test.ts` — 单测
- Host：`src-tauri/src/services/agent/acp.rs`（`AgentMessageChunk` → `message`，`AgentThoughtChunk` → `thought`）

---

## 1. 问题现象

使用 DeepSeek 推理类模型（如 DeepSeek-R1 / deepseek-reasoner 风格，或经部分 ACP Agent 代理的同类模型）时，对话 UI 可能出现：

1. **最终回答只出现在「Thinking / Reasoning」折叠块**，正文区为空或显示 `(empty response)`。
2. **正文与思考混在同一段 message 文本里**，且被 `<think>…</think>`（或同类标签）包住，未拆成 reasoning + text 两部分。
3. 流式过程中界面长时间停在“thinking”，结束后正文仍不可见或整段被当成思考。

用户侧观感：模型「想完了但没回复」，或「答案被藏在思考里」。

---

## 2. 根因

问题通常不是单一 bug，而是 **模型输出形态 × 中间 Agent/适配器 × 前端按 ACP 通道渲染** 叠加造成的。

### 2.1 DeepSeek 官方：推理与正文双字段

DeepSeek 推理模型在 API 层将输出拆成：

| 字段 | 含义 |
|------|------|
| `reasoning_content` | 思考过程（应进 Thinking UI） |
| `content` | 最终回答（应进正文） |

客户端若只读 `content`、或把 `reasoning_content` 误当成唯一输出，就会出现「有思考无正文 / 正文进错栏」一类问题。多轮对话时，部分服务还要求把历史 `reasoning_content` 正确回传，否则行为异常。

这是行业内普遍的适配点，并非 Agentero 独有。

### 2.2 文本内嵌标签

部分链路（蒸馏模型、代理、旧格式）会把思考写在 **message 文本** 里，用标签分隔，例如：

```text
<think>
…推理过程…
</think>

## 最终答案
…
```

同类别名还有 `<thinking>…</thinking>`、`<reasoning>…</reasoning>`。  
若前端把整段 `message` chunk 原样当正文渲染，标签会泄漏或思考与答案无法分栏；若整段被上层标成 thought，则答案会整段落进 Thinking。

### 2.3 ACP 通道误标（Agentero 侧直接触发路径）

Agentero 经 ACP 接收流更新：

| ACP 更新 | Host `AgentStreamKind` | UI 用途 |
|----------|------------------------|---------|
| `AgentMessageChunk` | `message` | 助手正文（可再拆 think 标签） |
| `AgentThoughtChunk` | `thought` | 仅 reasoning |

映射见 `acp.rs` 的 `stream_from_update`。

**部分 Agent / 模型适配器**会把本应走 `AgentMessageChunk` 的最终答案，全部或主要地发成 `AgentThoughtChunk`。  
对前端而言：

- 流式阶段只有 `kind=thought` → 全部进入 `reasoning` parts；
- turn 结束时若 `content` 也为空 → 正文为空，答案只留在 Thinking 里。

这是本仓库里观察到的主要故障形态之一：**「orphan thought」——有 reasoning、无 text**。

### 2.4 数据流示意

```text
  DeepSeek / 代理 CLI
        │
        ├─ reasoning_content  ──► (适配器) ──► AgentThoughtChunk ──► kind=thought
        ├─ content            ──► (适配器) ──► AgentMessageChunk ──► kind=message
        └─ 或 content 内含 <think>…</think>answer
        │
        ▼
  Agentero Host (acp.rs)  →  agent:stream 事件
        │
        ▼
  use-agent-panel：classifyStreamChunk / promoteOrphanThoughtToText
        │
        ▼
  UI：Reasoning 块 + 正文 Markdown
```

适配器若把 `content` 错映射到 Thought，或只转发 thought，UI 在修复前无法恢复正文。

---

## 3. 解决方案

在 **前端流解析层** 做兼容，不依赖某个特定 Agent 修 bug；Host 仍忠实转发 ACP 的 message / thought 通道。

### 3.1 消息通道：拆分 think 风格标签

`ThinkTagParser`（`agent-stream-parse.ts`）对 **`kind=message`** 的 chunk 做有状态扫描：

- 识别开标签：`<think>` / `<thinking>` / `<reasoning>`（大小写不敏感）
- 识别闭标签：`</think>` / `</thinking>` / `</reasoning>`
- 跨 chunk 边界时缓存不完整标签前缀，避免截断误伤
- 标签内 → `reasoning` part；标签外 → `text` part

`kind=thought` **不**再做标签反解为正文（通道语义已是思考）；误标正文的情况交给完成时兜底。

接入点：`use-agent-panel` 的 `applyStreamEvent` → `classifyStreamChunk` → `appendStreamPart`。

### 3.2 完成时兜底：提升 orphan thought

当 turn 结束（`agent:result`）时，若：

1. 已有 parts 中 **没有任何非空 `text`**，且  
2. 结果 payload 的 `content` 也为空，且  
3. 存在非空 `reasoning` parts，

则调用 `promoteOrphanThoughtToText`：

- 将 **最后一个** 非空 reasoning 块的 `type` 改为 `text`；
- 若存在多段 reasoning，**更早的**仍保留为思考（兼容「思考 → 工具 → 再思考 → 答案被误标」）。

仍无任何正文时，才回退为 `(empty response)` 占位。

### 3.3 为何这样设计

| 策略 | 优点 | 代价 / 边界 |
|------|------|-------------|
| 只修 Host / 某个 Agent | 语义更「正」 | 无法覆盖用户 BYOA 的多种 CLI；修不全 |
| 前端拆标签 + promote | 对用户立即可用；可测 | promote 可能把「纯思考、无答案」的最后一段当正文（少见） |
| 不在 thought 通道上拆标签 | 避免把真·思考里的伪标签抬成正文 | 完全误路由时必须靠 promote |

与业界常见做法一致：UI / 客户端在展示层兼容 `reasoning_content` 与内嵌 think 标签，并对「只有 reasoning」做降级展示。

### 3.4 测试

`test/agent-stream-parse.test.ts` 覆盖：

- 单 chunk 内 `<think>…</think>` + 正文拆分  
- 开闭标签跨 chunk  
- `<thinking>` / `<reasoning>` 别名  
- `classifyStreamChunk` 对 thought / message 的分流  
- `promoteOrphanThoughtToText`：单段提升、多段只抬最后一段、已有 text 时不改动  

本地：`pnpm exec vitest run test/agent-stream-parse.test.ts`。

---

## 4. 未覆盖 / 后续可选

- **适配器侧根治**：在具体 ACP Agent 内把 DeepSeek 的 `content` 正确发成 `AgentMessageChunk`，`reasoning_content` 发成 `AgentThoughtChunk`。前端兜底不能替代正确协议。
- **流式中途 promote**：当前仅在 turn 完成时提升；流式过程中答案若全在 thought 里，结束前仍只显示 Thinking（可接受）。
- **真·无正文的长思考**：promote 会把最后一段 reasoning 显示为正文；若产品要区分「无答案」与「误标答案」，需要 Agent 提供更可靠的 stop / 空 content 语义。
- **多轮 `reasoning_content` 回传**：属 Agent CLI / API 客户端职责，不在本修复范围。

---

## 5. 参考资料

### 官方与协议

- [DeepSeek API 文档 — 推理模型（reasoning_content / content）](https://api-docs.deepseek.com/guides/reasoning_model)
- [Agent Client Protocol](https://agentclientprotocol.com/) — `AgentMessageChunk` / `AgentThoughtChunk` 会话更新语义

### 业界同类问题（展示 / 适配层）

以下为公开讨论与 issue 中的常见模式，说明「推理进错栏 / 只有 thinking」并非个案：

- **Open WebUI** 等聊天前端：对 reasoning 字段与折叠 UI 的适配与回归讨论（字段映射错误会导致正文或思考缺失）。
- **OpenCode + DeepSeek** 社区反馈：仅有 reasoning、界面卡在 thinking 或结束后无正文（适配器与模型字段不同步时）。
- **agno / Kilo Code** 等 Agent 框架：处理 `reasoning_content` 与流式 delta 时的映射问题。
- 通用实践：客户端需同时处理  
  1）API 双字段；  
  2）`<think>` 类内嵌标签；  
  3）上游把最终答案误标为 thought 时的展示兜底。

### 本仓库

- 实现：`src/lib/agent/stream-parse.ts`  
- UI 接入：`src/components/agent/use-agent-panel.ts`（`applyStreamEvent`、turn 完成分支中的 `promoteOrphanThoughtToText`）  
- Host 通道映射：`src-tauri/src/services/agent/acp.rs` → `stream_from_update`  
- 备忘勾选：`docs/development/bug.md`（对话 / Agent 一节）

---

## 6. 变更摘要（便于 review）

| 项 | 说明 |
|----|------|
| 问题 | DeepSeek 类模型回答出现在 Thinking，正文为空 |
| 原因 | 双字段 / `<think>` 标签 / ACP thought 误路由 |
| 修复 | message 流拆标签 + 完成时 promote 最后 orphan reasoning → text |
| 验证 | `test/agent-stream-parse.test.ts` |
| 不修 | 各 BYOA Agent 内部对 DeepSeek API 的字段映射（仍建议上游正确） |
