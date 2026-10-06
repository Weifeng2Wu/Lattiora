# 网页前端

原 React 19 工作台保留三栏、文件树、论文库、EmbedPDF/PDFium 阅读批注、Plate Markdown、CodeMirror 和 Dockview 多面板。`src/App.tsx` 继续组装原组件；浏览器文件 API 替代原本机 Host，右侧使用统一内置 AI。

| 边界 | 当前实现 |
|---|---|
| 登录与离线启动 | `components/cloud/cloud-gate.tsx`、IndexedDB、Service Worker |
| 导入、导出、同步与设置入口 | `components/cloud/cloud-toolbar.tsx` |
| 统一 AI 与持久化对话 | [Agent](agent.md) |
| 配置、语言与密钥 | [设置](settings.md) |
| PDF 浏览器正文提取 | [解析](pdf-layout-analysis.md) |
| 翻译 | [翻译](translate.md) |
| 数据契约 | `lib/cloud/`；原 `core/bindings.ts` 只保留 UI 类型及兼容调用边界 |
| 样式与交互 | Tailwind、Radix/shadcn、Lucide、Sonner；沿用原设计 |
| 状态与布局 | 按域 zustand store，Dockview 布局保存在设备内 |

[部署与日常操作](../deployment/cloudflare.md)、[逐项能力与限制](../deployment/capabilities.md)、[验收](../test/cloudflare.md) 描述当前支持范围。

以下文档保留原组件设计，涉及 Rust、ACP 或原生窗口的段落仅作迁移前背景，不是网页操作说明：[工作区](workspace.md)、[文件树](vault-tree.md)、[论文库](library.md)、[Markdown](markdown.md)、[PDF](pdf.md)、[Wiki](wiki.md)、[组件](components.md)、[Shell 与 i18n 约定](shell.md)。新增行为与旧实现有差异时，以上网页说明优先。
