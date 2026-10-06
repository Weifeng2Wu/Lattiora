# ACP 历史回放：Agent 回复被 "No response requested." 占位

**状态**：已修复（Host 回放聚合过滤合成占位文本）
**影响面**：Agent 历史抽屉 → `session/load` 回放 → 会话气泡渲染
**相关代码**：

- `src-tauri/src/features/agent/acp.rs` — `ReplayBuilder::finish`、`is_synthetic_replay_placeholder`
- 前端消费方：`src/components/agent/hooks/use-agent-history.ts`（`openHistorySession` / `titleFromLoadedHistory`）
- 设计总览：[`../backend/agent.md`](../backend/agent.md)（`session/load` 回放小节）

---

## 1. 问题现象（#411）

重新打开较早的 Agent 会话（Claude，经 `claude-agent-acp`、第三方模型
`deepseek-v4-pro`）时，原本完整的 assistant 回答正文消失，气泡末尾只剩
工具调用 / 思考过程行，外加一段字面量 **"No response requested."** 被当作
Agent 回复渲染。对话的连续性没有破坏：继续追问时模型仍「记得」之前的回答。

## 2. 根因

Agentero 不持久化会话历史，重启后历史来自 ACP `session/list` + `session/load`
回放。问题出在 Claude 侧的 transcript 反序列化（上游行为，非 Agentero 生成）：

1. Claude Code 的 `deserializeMessagesWithInterruptDetection` 在 load/resume 时
   跑一串过滤器：`filterUnresolvedToolUses` → `filterOrphanedThinkingOnlyMessages`
   → 第三方 provider 时 `stripThinkingBlocks` → `filterWhitespaceOnlyAssistantMessages`。
2. 若过滤后最后一条相关消息是 user 消息（例如 turn 被中断、或 assistant 文本
   被上述过滤器清掉），会**拼接一条合成 assistant 消息**，内容即常量
   `NO_RESPONSE_REQUESTED = "No response requested."`。
3. `claude-agent-acp` 的 `replaySessionHistory` 把 `getSessionMessages()` 的
   结果逐条原样转成 `session/update` 回放（仅跳过合成登录消息），占位文本因此
   进入 Agentero 的 transcript UI。

真实回答正文被上游过滤器丢弃属于 Claude SDK 行为，Agentero 无法恢复；能做的
是不把合成占位当作回答展示。

## 3. 修复

`ReplayBuilder::finish()` 在聚合 `session/load` 回放行时，对 Agent 行按整段
精确匹配（trim 后）丢弃合成占位文本：

- `No response requested.`
- `[Request interrupted by user]`
- `[Request interrupted by user for tool use]`

占位若是某行的唯一内容，整行落入既有的「空内容丢弃」逻辑；若与真实
tool/plan/reasoning 部分混排，只剔除占位文本部分。过滤只作用于 Agent 行，
不影响用户消息。

## 4. 验证

- `cargo test -p agentero replay_builder`：新增
  `drops_synthetic_placeholder_agent_turns`、
  `keeps_real_parts_in_turns_mixed_with_a_placeholder`，连同既有 9 个用例全部通过。
- 探针（最小 stdio ACP 客户端 `initialize` + `session/load`）确认
  `qodercli --acp` 回放不含该占位；占位仅在 Claude 适配器的受影响会话出现。
