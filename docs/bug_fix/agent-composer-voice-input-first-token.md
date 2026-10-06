# Agent Composer 首次语音输入被吞

**状态**：已修复（composition / dictation 期间延后外部 draft DOM 同步）  
**影响面**：右侧 Agent 侧边栏 Composer（行内 chip 的 `contenteditable` 输入框）

## 现象

打开右侧 Agent 侧边栏后，立即使用系统语音输入或输入法开始首段输入时，第一段文字可能没有出现在 Composer 中；再次输入正常。

## 根因

Agent 面板首次挂载时会异步加载默认 Agent、会话 scope 和持久化草稿。Composer 输入框本身是 `contenteditable`，外部 `value` 变化会通过 `replaceChildren()` 重建 DOM，以便把 `@` / `$skill` / `/command` / 选区 marker 渲染成行内 chip。

语音输入和 IME 组字的首段文本可能先落在 DOM 中，随后 React 父状态才收到稳定 input echo。若此时 Agent 初始化带来的外部 draft 同步重建 DOM，就会清掉这段尚未被父状态确认的文字。

## 修复

- 新增 `decideComposerExternalValueSync()`：集中判断外部 `value` 是否允许重建编辑器 DOM。
- `ComposerInlineInput` 在 composition 中、或等待父状态回显用户输入时，延后不相关的外部 draft 同步。
- `@` / `$skill` / `/command` 菜单触发的 inline token commit 仍允许立即同步，避免破坏 chip 渲染。
- `compositionend` 主动从 DOM emit 一次，确保输入法提交后的最终文本写回父状态。

## 验收

1. 刚打开 Agent 侧边栏，立即使用系统语音输入，首段文本保留。
2. 中文输入法组字确认不会误发送，确认后的文本保留。
3. `@`、`$skill`、`/command` 选中后仍渲染为行内 chip。
4. 打开历史会话 / 未聚焦输入框时，保存草稿仍可恢复。
