# 网页设置

顶栏设置使用 `src/components/cloud/cloud-ai-settings-dialog.tsx`，提供语言和统一 AI 配置。原桌面 Agent 安装、系统命令、自动更新、代理、SSH、loopback Zotero、原生编译器和解析器设置不再是网页入口。

AI 字段：provider（Anthropic / OpenAI 兼容）、base_url、api_key、model。服务地址必须为公开 HTTPS；默认以 /v1 为前缀，支持自定义路径。更改供应商或地址需重新录入 key，防止旧 key 泄漏给新服务。

Worker 加密保存完整模型配置，读接口仅返回非敏感字段和 hasKey。保存空 key 会在供应商/地址未变时保留已有 key；删除配置可移除 D1 中的密文。密码和主加密密钥由 Workers Secrets 管理，不通过浏览器管理。

界面主题、Dockview 布局、阅读位置和语言属于本设备偏好。文件、论文 metadata、批注及对话参与跨设备同步。参见 [安全与部署](../deployment/cloudflare.md)。
