# Agent 历史会话恢复加载反馈

**Issue**：[#516](https://github.com/poco-ai/Agentero/issues/516)

**影响面**：右侧 Agent 侧边栏的历史会话恢复

## 问题

点击只有 ACP provider id、但本地还没有 transcript 的历史会话时，前端会等待 `session/load` 完整返回后再激活会话。若 provider 回放历史较慢，侧边栏内容区会停留在旧会话或空白状态，用户无法判断点击是否生效。

## 修复

- `agent-session-store` 新增 `hydratingSessionId`，用于表达当前 active tab 正在通过 `session/load` 恢复。
- 打开需要远端加载的历史项时，先把该历史项以空 transcript upsert 并激活，再发起 `session/load`。
- `ChatTranscript` 在 active tab 处于 hydrating 且暂无线条时展示 Shimmer 文案和消息骨架；加载成功后由 `hydrateAndActivateSession` 原子替换为真实内容。
- 本地已有 transcript、切换 Vault/Agent、新建会话和跨窗口 handoff 会清理 hydrating 状态，避免占位泄漏到其它会话。

## 验证点

- 点击外部/远端历史会话后，Agent 侧边栏立即显示恢复占位。
- `session/load` 完成后，占位替换成真实多轮 transcript。
- 本地已有内容的历史项仍然立即显示真实内容。

Roadmap 与 TODO 已检查：这是已实现 Agent 历史恢复能力的体验缺陷修复，不新增未完成产品项。
