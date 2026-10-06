# 统一网页 AI

`src/components/cloud/cloud-agent-panel.tsx` 位于原右侧栏。单一配置通过 Worker 连接 Anthropic 或 OpenAI 兼容 API，替代本机 ACP 进程、Agent 安装和权限审批。配置方法见 [部署说明](../deployment/cloudflare.md)。

- 流式问答、总结、停止、显式重试；请求失败或中断保留已收到文本，不自动重发付费请求。
- 选区与当前已保存文档作为上下文。PDF 优先使用已提取正文；区域图片经配置的视觉模型识别后附加文本，可能产生额外模型请求。
- 对话保存为 `.agentero/chats/*.json`，包含周期 checkpoint、中断状态和历史；使用普通文件同步与备份。
- 回复可新建 Markdown 笔记或追加到当前笔记；实际文件写入由应用按钮执行。模型文本不能直接执行 shell、SSH、任意工具或自行修改文件。
- 原 PDF 选区问答卡通过相同 Worker API；`marks/` 线程定期保存，并在停止/阅读器卸载时保存剩余文本。普通文档临时选区卡仍是临时卡片，长期对话使用右侧 AI。

API Key 只通过 HTTPS 提交到 Worker，加密后进入 D1；不进入客户端持久化或 ZIP。模型/视觉费用由所配置供应商收取。离线可查看已保存对话，发送请求需要联网。

协议夹具已验证 Anthropic 与 OpenAI 的请求格式/SSE/翻译/OCR；真实模型凭据尚未提供，不能据此宣称真实模型质量已通过，见 [验收记录](../test/cloudflare.md)。
