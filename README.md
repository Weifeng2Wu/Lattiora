<div align="center">
  <img src="docs/assets/lattiora-icon.svg" alt="Lattiora Logo" width="80" height="80" />
  <h1>Lattiora · 研织</h1>
  <p>将论文、笔记和研究线索，织成自己的知识网络。</p>
  <p><strong>中文</strong> · <a href="README.en.md">English</a></p>
</div>

Lattiora 是一个可自行部署的个人科研工作台。在浏览器中管理论文、阅读与批注 PDF、记录双链笔记，并结合 AI 整理研究材料。桌面与手机共享同一套数据；已缓存的文件和笔记支持离线使用，联网后同步。

## 主要能力

- **论文管理**：导入 PDF、DOI、arXiv 和 Zotero 导出题录，识别元数据，按文件夹组织文献。
- **阅读与翻译**：PDF 搜索、高亮、区域批注、阅读笔记与多渠道翻译，将阅读和记录放在一起。
- **知识整理**：Markdown 富文本与源码编辑、双向链接、反向链接和全文搜索；支持 Excalidraw 白板、思维导图与看板。
- **AI 助研**：围绕论文、选区和笔记提问，使用内置文档工具与 Skills；支持 Anthropic 和 OpenAI 兼容服务。
- **研究首页**：查看阅读进度、看板待办和会议截稿倒计时，通过论文广场与 RSS 发现研究线索。
- **数据自主**：文件可导出、工作区可备份，笔记可生成只读分享链接；同步冲突保留副本。

## 快速开始

### 部署自己的工作台

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Weifeng2Wu/Lattiora)

应用运行于 **Cloudflare Workers + D1 + R2**，浏览器使用 IndexedDB 保存本地工作副本。准备 Cloudflare 账号并启用 R2，按照[部署指南](docs/deployment/cloudflare.md#使用-deploy-to-cloudflare-按钮)设置资源、登录密码与加密密钥，再部署和登录。论文广场的两个代理需单独部署，详见指南。

首次登录后，在设置中选择所需的 AI、翻译与解析服务。AI 和在线学术服务需要联网，费用及额度由对应服务商决定。离线前请等待“离线缓存已就绪”并完成文件同步。

### 本地开发

需要 Node.js 22+、pnpm，以及支持 IndexedDB、Web Locks 和 Service Worker 的现代浏览器。先按[本地配置说明](docs/deployment/cloudflare.md#本地运行)准备 `.dev.vars`，然后运行：

```bash
pnpm install --frozen-lockfile
pnpm db:migrate:local
pnpm build
pnpm dev:web
```

打开 <http://127.0.0.1:8790>。开发时可另开终端运行 `pnpm dev`；离线行为使用生产构建验证。

## 文档

| 想了解什么 | 文档 |
| --- | --- |
| 部署、登录、离线、备份与费用 | [部署与使用](docs/deployment/cloudflare.md) |
| 支持哪些功能、有哪些限制 | [能力清单](docs/deployment/capabilities.md) |
| 数据存储、同步与技术结构 | [架构说明](docs/architecture.md) |
| 开发计划与验证情况 | [Roadmap / Todo](docs/development/web-migration.md) · [验证记录](docs/test/cloudflare.md) |
| 名称与 Logo | [品牌说明](docs/frontend/branding.md) |

Lattiora 面向个人使用，采用单人密码登录。离线能力依赖当前浏览器的缓存；退出登录会锁定界面，但不会加密或清除设备上的本地副本。完整功能边界见能力清单。

## 许可与致谢

Lattiora 基于 [poco-ai/Agentero](https://github.com/poco-ai/Agentero) 开发，遵循 [MIT License](LICENSE)，保留原作者 `Copyright (c) 2026 poco-ai` 及完整许可声明。感谢上游项目及其贡献者。Lattiora 是独立的 Cloudflare 网页衍生版本，并非上游官方发布。
