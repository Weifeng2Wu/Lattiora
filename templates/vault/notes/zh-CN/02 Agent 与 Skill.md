# Agent 与 Skill

Lattiora 只使用内置 Agent。在设置 → Agent 配置 **provider、base URL、API Key、model** 并测试连接，支持 Anthropic 和 OpenAI 兼容服务。Key 在 Worker 端加密保存，模型调用由你的供应商计费。

## Agent 面板

点击右上角的侧边栏按钮打开 **Agent** 面板。（`⌘+L`）

打开论文时，当前论文会自动加入 Agent 上下文。你可以：

- 直接输入问题。
- 用 `@` 提及 Vault 中的任意路径。
- 使用 `$` 选择 Skill，使用 `/` 选择工作流或 Slash Command。
- 从文件树拖入文件或文件夹到输入区,成为上下文。
- 在 PDF 中选中文本或批注并发送给 Agent。

Agent 回复过程中仍可继续输入，后续消息会进入队列，当前回复结束后自动发送。

## Skill

### 使用 Skill

在对话当中使用 `$` 选择 Skill，使用 `/` 选择工作流或 Slash Command。

### 修改 Skill

直接编辑对应的 `SKILL.md`。

### 新增 Skill

在 `.agents/skills/` 下新建文件夹并放入 `SKILL.md`。

使用 Skills 导入面板选择公开 GitHub 来源，或上传 SKILL.md / ZIP 包。导入文件可离线使用并参与同步和备份。

### 内置 Skill

内置 Skill 包括：

- `paper-reader` — 精读论文并写入 `NOTES.md`。
- `agentero-workspace` — 使用内置文档与研究工具。
- `vault-normalizer` — 将现有研究目录整理为 Lattiora Vault 布局。
- `deep-research` — 多轮研究并带引用。
- `idea-evaluator` — 多角度评估研究想法。

### 案例1：精读论文

论文需有本地 PDF 且具备可读正文（TeX 或 `PAPER.md`）：

- **手动精读**：在未读论文行点击 **精读图标**。
- **自动精读**：设置 → Agent 开启 **autoPaperReader**（默认关闭）。

精读结果写入该论文的 `NOTES.md`，完成后论文标记为已读。

## 设置

### 模型配置与故障排查

1. 打开 **Settings** → **Agent**。
2. 填写服务协议、base URL、API Key 和 model。
3. 先点击连接测试，再开始对话。

请求失败时检查模型名、服务地址、供应商余额和返回错误。网页版不调用本机 ACP 可执行程序。

## 下一步

- [[01 论文导入与管理]]
- [[03 Markdown 与双链]]
