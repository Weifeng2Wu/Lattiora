# 网页内置 Agent

0.14.0 恢复 `b6320ce5` 的 AgentPanel、输入框、历史、模型选择、消息编辑重发、发送队列、推理/工具/计划、结构化问答和权限弹窗。右栏使用原 React 组件；删除早期的简化 CloudAgentPanel。只提供内置 Lattiora，不安装或启动 Claude Code、Codex、OpenCode、ACP/SSH/终端进程。

## 配置与费用

在设置 → Agent 配置 provider（Anthropic 或 OpenAI-compatible）、base URL、API Key、model，并使用“测试连接”。没有附带模型账号、公共代理或 Key。Key 沿用 Worker 加密存储，浏览器只收到是否已配置；模型列表预加载只读取配置，不发送付费模型请求。测试连接、聊天和自动精读会产生供应商用量，Cloudflare 免费额度不包含模型费用。

翻译默认使用已配置的 AI；其它翻译渠道须显式填写地址，商业渠道另填自己的 Key/region/model。打开下拉菜单不自动调用各渠道；连接由用户点击测试。应用仍保留原渠道选择和参数。

## 工具与上下文

`@` 文档、当前文件、文字选区、视觉批注、图片和 `$skill` 沿用原输入交互。文档实际读取 IndexedDB 文件、已解析正文或浏览器 PDFium 文本；扫描页没有解析结果会报错。每次请求最多 240,000 字符上下文，超限报错而非假装读完。工具单次正文读取最多 60,000 字符，返回后续偏移；搜索仅覆盖已缓存文本。图片最多 8 张；浏览器压缩大型图片，浏览器不能解码的格式如实报错。

`@` 候选中有子项的目录在鼠标悬停后展开旁侧子菜单，可连续浏览嵌套目录并点击文件。父目录保持可见并可点击引用整目录；箭头按钮、键盘方向键与 Enter 保持可用。使用现有 HoverCard 的延迟开合及边缘避让。隔离 Wrangler/Chromium 已验证两层悬停、点击子文件、点击父目录和键盘选择。

Worker `/api/ai/agent` 适配两类 SSE 协议，检查完整结束帧后才向浏览器交付工具调用；截断、坏 JSON 和超长输出不执行工具。每轮最多 12 次模型请求，单次 180 秒。工具只有 `list_files`、`read_document`、`search_documents`、`write_note`、`update_plan`、`ask_user`；没有任意命令执行。供应商须支持所选工具/图片，否则返回错误，不伪造成功。

写笔记需要当前完整原文作为 CAS 基线；受限模式禁止写，询问模式展示前后内容并等待批准，自动模式依然校验版本和未保存编辑。笔记与 `.agentero/agent-edits/<id>.json` 修改记录原子落盘，进入正常 outbox；聊天过程面板可展开修改并保留/撤销，离线同样可操作。撤销若发现后续磁盘或未保存编辑会拒绝覆盖。撤销新建笔记生成同步删除记录；已保留或已撤销操作不重复执行。

## 会话与 Skills

对话保存在 `.agentero/agent-sessions/<id>.json`，流式过程每 1.5 秒 checkpoint，成功/取消/失败再保存。刷新后可从原历史弹窗打开；离线能阅读，不能生成模型回复。继续对话携带历史和实际工具结果；编辑重发保留旧会话并创建分支。另一设备改变当前会话时，后续写入保留分支；同步冲突副本也列入历史。旧 `.agentero/chats/*.json` 仍可读。会话、笔记修改记录、用户 Skills 均随普通文件备份；其中包含用户提供给模型的文档/图片上下文。

恢复 6 个原研究 Skill 的知识和 Markdown references：acdemic-drawing、deep-research、idea-evaluator、paper-reader、research-paper-writing、vault-normalizer；以 `agentero-workspace` 替代原本机 CLI Skill。原 Vault `AGENTS.md` 已按网页工具边界恢复，每轮读取用户本地覆盖规则。选择 `$skill` 后注入实际正文，附属 references 可通过工具读取。`.agents/skills/<id>/SKILL.md` 用户版本优先；初始化只补缺失文件，不覆盖修改。绘图在浏览器画布导出，原 Python renderer 不提供；外部搜索/编译等没有对应工具时须明确说明，不能假装执行。

精读使用原后台任务/进度/取消管线和 paper-reader Skill，只有确实写入目标 `NOTES.md` 才标记已读。后台运行不发无人接收的交互提问。PDF 页引用通过真实页数验证，图/节引用须有对应版面侧车，缺失或歧义报错。

## 尚需完成的原功能

这是一批恢复，不是完整迁移交付。GitHub/npx 公开来源已接回原多选窗（见 [web-skills](web-skills.md)）；其余 Plaza/推荐消费者、ONNX 版面模型、引用提取与入库识别等仍见[逐项审计](../development/migration-feature-audit.md)。Plaza scratch 下载适配已接浏览器缓存，但整体 Plaza 入口尚未验收。精读真实模型输出质量、全部队列/取消边缘路径、供应商工具兼容差异仍需验证。

模板更新目前只自动补缺失文件。已存在的 Skill/AGENTS 内容不自动升级；这是当前仍需补齐的原版模板管理差异，避免覆盖用户修改。原本的入门笔记与 thesis 示例模板也尚未恢复。
