# ACP 会话恢复使用错误的 Session ID

**状态**：已修复（保存并复用 ACP provider session ID）  
**影响面**：Agent 对话面板的多轮对话、`session/resume`  
**相关代码**：

- `src-tauri/src/models/agent.rs` — `AgentResultPayload.provider_session_id`
- `src-tauri/src/services/agent/acp.rs` — 返回 ACP provider session ID
- `src/lib/agent/api.ts` — 前端结果 payload 类型
- `src/components/agent/use-agent-panel.ts` — 保存并复用 provider session ID

## 1. 问题现象

使用支持 ACP 会话持久化的 Agent（例如 Qoder CLI）进行第二轮对话时，Agent 可能返回：

```text
Invalid session identifier
```

同时，Agent CLI 的会话列表中实际存在可恢复的会话，但 Agentero 仍无法继续上一轮对话。

## 2. 根因

此前 Agentero 将自己的运行 ID 当作 provider 的 ACP session ID 使用。两者用途不同：

| 标识 | 生成方 | 用途 |
|---|---|---|
| Agentero run/session ID | Agentero | 关联前端事件、流式输出和当前聊天页 |
| ACP provider session ID | Agent / ACP provider | `session/resume`、`session/load` 和 provider 侧会话持久化 |
| `cwd` | Agentero / provider | 限定会话所属项目目录 |

一次 `session/new` 调用后，ACP provider 会返回自己的 session ID。旧实现没有把这个 ID 传回前端，而是在发送完成后继续使用 Agentero 的运行 ID。因此下一轮调用 `session/resume` 时，provider 会在当前项目目录下查找一个并不存在的会话，最终报 `INVALID_SESSION_IDENTIFIER`。

这个问题不是项目目录本身无效，也不是会话一定丢失；主要是恢复请求携带了错误的 ID。

## 3. 解决方案

### 3.1 Host 返回 provider session ID

`AgentResultPayload` 新增可选字段 `provider_session_id`。ACP `session/new` 或 `session/resume` 完成后，Host 将实际使用的 ACP session ID 放入完成事件。

取消或未建立 ACP session 的情况不填充该字段。

### 3.2 前端只保存 provider session ID

Agent 面板收到当前活动会话的完成事件后，将 `providerSessionId` 保存到 `activeConversationRef`。下一轮发送时，该值才会作为 `sessionId` 传给 Host，并触发 ACP `session/resume`。

完成事件属于已切换到其它标签页的旧会话时，不更新当前活动会话的恢复 ID，避免异步完成事件污染另一段对话。

## 4. 修复后的数据流

```text
首次发送
  → ACP session/new
  → provider 返回 ACP session ID
  → Host agent:completed 携带 providerSessionId
  → Agentero 保存 providerSessionId

后续发送
  → 使用 providerSessionId 调用 session/resume
  → provider 在当前项目目录中恢复原会话
  → 继续发送 prompt
```

## 5. 验收建议

1. 使用支持会话持久化的 ACP Agent 连续发送两轮消息。
2. 确认第二轮不再出现 `INVALID_SESSION_IDENTIFIER`，且 Agent 能够利用第一轮上下文。
3. 切换到另一聊天标签页后再完成旧请求，确认不会覆盖当前标签的恢复状态。
4. 使用 `--list-sessions` 检查时，列表中的 provider session ID 应与 Agentero 后续恢复所使用的 ID 一致。

## 6. 边界

- provider 不支持会话恢复时，仍按 provider 能力走新会话或禁用恢复。
- provider 侧删除会话、清理会话存储或更换项目目录后，旧 session ID 仍可能失效；这属于 provider 会话生命周期问题。
- 本修复不改变 Agentero 的前端事件关联 ID，也不把 provider session ID 当作本地文件名或 Vault 数据来源。
