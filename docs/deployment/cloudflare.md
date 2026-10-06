# Cloudflare 部署与使用

这是原 Agentero React 工作台的网页迁移：文件树、论文库、EmbedPDF/PDFium 阅读器、Plate Markdown、Dockview 多面板继续使用原实现。运行时只有浏览器和 Cloudflare Workers、D1、R2；不需要 Rust、Tauri、本机 Agent 或常驻服务器。

## 使用 Deploy to Cloudflare 按钮

按钮入口位于 [README](../../README.md#部署自己的工作台)，部署其链接仓库的默认分支。以下设置适用于首次创建自己的部署。

1. 准备 Cloudflare 和 GitHub/GitLab 账号，在 Cloudflare 账户启用 **R2**。点击按钮并授权复制源码仓库，选择 Worker 名称。
2. 让向导创建自己账户的 D1 数据库（绑定名 **`DB`**）和 R2 桶（绑定名 **`FILES`**），不要沿用本仓库的数据库 ID。
3. 设置根目录 `.env.example` 声明的两项 **Worker Secrets**。分别运行两次 `openssl rand -hex 32` 生成独立值，妥善保存：

   | Secret | 用途 |
   | --- | --- |
   | `ACCESS_PASSWORD` | 登录密码，至少 32 字符 |
   | `ENCRYPTION_KEY` | 加密已保存的服务 API Key，必须为 64 位十六进制；升级时保持不变 |

4. 将构建和部署设置为下表值。部署命令使用绑定名 `DB`，即使向导重命名数据库也能定位资源：

   | 配置 | 值 |
   | --- | --- |
   | 项目根目录 | `/` |
   | 构建环境变量 | `NODE_VERSION=22`、`PNPM_VERSION=11.5.3` |
   | 构建命令 | `pnpm build` |
   | 部署命令 | `pnpm exec wrangler d1 migrations apply DB --remote && pnpm exec wrangler deploy` |

5. 清空主配置的 `PLAZA_COOL_ORIGIN` 和 `PLAZA_MODELSCOPE_ORIGIN`，或替换成自己部署的代理地址。向导无法编辑时，先修改自己仓库的 `wrangler.jsonc` 再部署。主按钮只部署主应用；完整论文广场需另行部署两个 [Plaza Worker](../frontend/web-plaza-live.md#部署)。
6. 打开部署后的 HTTPS 地址，用 `ACCESS_PASSWORD` 登录，在设置中配置并测试所需服务。离线前等待“离线缓存已就绪”且文件同步完成。

向导未收集 Secrets 时，在主 Worker 的 **Settings → Variables and Secrets** 中以 Secret 类型添加后部署。出现 `no such table` 时检查 D1 迁移命令与 `DB` 绑定；登录配置错误时检查两项 Secret 格式。下文 `.env.cf` 和 `scripts/cloudflare.mjs` 仅用于本地命令行部署，不应作为 Workers Builds 的部署入口。

按钮配置参考 [Cloudflare 官方文档](https://developers.cloudflare.com/workers/platform/deploy-buttons/)。现有实例发布已验证；从按钮复制仓库并首次创建资源的完整流程仍待独立验证。

## 本地运行

需要 Node.js 22+、pnpm（版本见 package.json），以及支持 IndexedDB、Web Locks、Service Worker 的现代浏览器。正式环境必须 HTTPS；本地 localhost 可用。

```bash
pnpm install --frozen-lockfile
# 本地测试凭据，不能用于生产
printf 'ACCESS_PASSWORD="local-development-password-32-chars"\nENCRYPTION_KEY="abababababababababababababababababababababababababababababababab"\n' > .dev.vars
pnpm db:migrate:local
pnpm build
pnpm dev:web
# http://127.0.0.1:8790
```

开发时另开终端运行 `pnpm dev`（1420，/api 代理到 8790）。离线启动必须用生产构建和 Wrangler，Vite HMR 模式不注册 Service Worker。`pnpm clean` 只删除 dist-web，不删除本地 D1/R2。

## 首次部署

`.env.cf` 支持 `CF_API` 或 `CLOUDFLARE_API_TOKEN`，不会打包到前端，也不进入 Git。`scripts/cloudflare.mjs` 只把凭据传给 Wrangler 子进程；不要把文件内容粘贴进日志。可用标准 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 环境变量覆盖。多账户令牌必须指定 account ID。

令牌需要账户 Workers 编辑、D1 编辑、R2 编辑权限；workers.dev 子域应可用。R2 需在账户启用，是否要求付款方式由 Cloudflare 决定。

```bash
node scripts/cloudflare.mjs d1 create agentero-web
node scripts/cloudflare.mjs r2 bucket create agentero-web
# 将返回的 D1 database_id 写入 wrangler.jsonc
pnpm db:migrate:remote
```

本仓库 wrangler.jsonc 的 ID 对应本次已创建的专用数据库。换账户部署必须替换，不能照搬。

生成两项**独立**随机生产密钥，保存为被忽略、权限 600 的 JSON 文件；ACCESS_PASSWORD 至少 32 字符，ENCRYPTION_KEY 为 64 位十六进制。以下命令拒绝覆盖已有文件，避免意外丢失解密密钥：

```bash
node --input-type=module - <<'JS'
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
writeFileSync('.dev.vars.production.json', JSON.stringify({
  ACCESS_PASSWORD: randomBytes(32).toString('base64url'),
  ENCRYPTION_KEY: randomBytes(32).toString('hex')
}, null, 2), { mode: 0o600, flag: 'wx' });
JS
node scripts/cloudflare.mjs secret bulk .dev.vars.production.json
pnpm deploy
```

进入 Wrangler 输出的 HTTPS 地址，用该文件中的 ACCESS_PASSWORD 登录。单人共享密码模式没有注册、邮箱、找回密码或多租户。密码变更使既有会话失效。ENCRYPTION_KEY 丢失或替换会导致已保存的模型 Key 无法解密；应另行离线备份这项密钥，轮换后重新录入模型配置。

## 日常工作和离线

1. 首次联网登录，导入 PDF、BibTeX/RIS/JSON 或普通文件。单击论文库行打开原 PDF + Notes 双栏。原文件树支持新建、移动、重命名和回收站；Markdown/源文件/Excalidraw/思维导图/Kanban 使用浏览器存储。
2. 顶栏显示本地保存和待同步数量，可主动重试。等顶栏显示“离线缓存已就绪”、文件同步完成后再断网。完整预缓存包含编辑器、字体、PDFium 和其他懒加载模块，首次下载较大。
3. 离线可刷新启动、阅读已缓存 PDF、编辑笔记/批注、查看已保存对话。首次从未访问过的浏览器不能离线登录；隐私模式、清理网站数据或系统回收站点存储会使本地副本消失。应用请求持久化存储，但浏览器可拒绝。
4. 恢复联网或页面聚焦会自动重试；失败使用指数退避及随机抖动。空闲轮询约 60 秒。登录过期时保留本地编辑，重新登录后继续同步。
5. 文件冲突不自动覆盖丢失的一方：服务器最新版本成为原路径，另一版本及删除冲突说明保存在 `Conflicts/`，恢复区从文件树和搜索隐藏，在「设置 → 同步 → 处理冲突」比较和恢复。编辑器保存也进行本地版本检查。路径移动跨云文件逐项同步，其他设备可能短暂看到中间状态。
6. 新 Service Worker 等旧页面关闭后激活；不会强制刷新正在编辑的页面。更新后关闭同站点所有标签页再重开。浏览器布局和阅读位置属于设备状态；界面偏好、文件、论文 metadata、批注和对话跨设备同步。

登录保护工作区数据/API；主动创建的分享链接通过独立公开 API 按密钥和有效期授权。应用静态代码可以公开缓存，其中不包含用户数据或密钥。退出会锁定界面，但**不会加密或删除 IndexedDB 中的本地副本**；只在可信设备使用。没有端到端加密；服务器端模型 Key 使用 AES-GCM 加密，文件依赖 Cloudflare 存储和账号安全。

## AI 配置和费用

顶栏设置填写 API protocol、Base URL、API key、Model name。OpenAI 兼容服务请求 `<base_url>/chat/completions`，Anthropic 请求 `<base_url>/messages`，支持自定义路径前缀；通常 base_url 包含 `/v1`。必须是公开 HTTPS 地址，不接受本机地址、内网 IP 或重定向。切换服务地址时需重新提供 key，以免把旧 key 发给另一服务。

Key 仅通过 HTTPS 发送给 Worker，AES-GCM 密文写入 D1；界面只接收 `hasKey`。R2、IndexedDB、ZIP 和对话均不保存 key。浏览器看到的模型配置不包含明文 key。

统一 AI 支持流式问答、选区/已保存文档上下文、总结、翻译、将答案新建为笔记或追加笔记，支持停止/重试、对话历史和中断标记。文本 PDF 可在浏览器提取正文；扫描页需配置支持图像的模型，解析时调用 OCR。PDF 上的原阅读批注 UI 继续使用文件侧车。

模型调用由你配置的供应商计费，**Cloudflare 免费额度不包含模型 token 或 OCR 费用**。第三方“兼容”服务可能不支持图像或标准 SSE，需用自己的模型验证。文档/选区会发给该服务；界面明确显示将包含的已保存文档。当前上下文最多约 100,000 字符，不做静默截断。失败和取消保留已收到的文本，不自动重发付费模型请求。

## 导入、备份与恢复

- 顶栏导出完整 ZIP：真实文件 + `agentero-backup.json`（SHA-256 校验）；包括 metadata、笔记、PDF、批注、回收站和对话，不包含密码/key/会话。
- 恢复先校验整个 ZIP，再在单次 IndexedDB 事务中导入；已有不同内容放入 `Conflicts/restore-*`。恢复是合并操作，不删除备份之外的文件。
- 每文件最多 32 MiB；ZIP 解压总量最多 256 MiB，最多 20,000 条目。大库需后续流式/分卷备份支持。普通文件可以直接从 ZIP 的 files/ 目录取出。
- BibTeX/RIS 导出可与 Zotero 等工具交换题录。Zotero 通过导出的题录和 PDF 导入，不访问 localhost Connector。原生 Zotero 批注同步不可等价保留。
- 不可直接把桌面 `catalog.sqlite` 丢进浏览器假装完成迁移；旧库应先导出题录并保留原 Vault 文件，或使用 `scripts/convert-vault.py`（见能力清单）。
- 云端灾备：`node scripts/cloudflare.mjs d1 export agentero-web --remote --output=/safe/path/d1.sql`，同时备份 R2 和生产密钥。只有 D1 SQL 不含 PDF。优先用应用 ZIP 获取一致的本地工作副本。
- R2 历史 blob 和 D1 重试回执目前不自动 GC。删除/覆盖不代表立即释放所有云端空间；定期查看用量，暂不自行清理引用关系不明的对象。

## 免费额度与边界

设计采用静态资源直出、索引增量拉取、元数据按论文拆文件、二进制进 R2，并避免每次空闲轮询遍历全库。仍不能保证任何规模都免费。

| 服务 | 官方免费档参考 | 本应用相关边界 |
|---|---|---|
| Workers | 100,000 动态请求/日，免费档 CPU 时间 10 ms/请求 | 大批量文本、密钥加密、OCR 流式处理可能触限；真实大文档负载需观察 |
| Static Assets | 静态请求免费；20,000 文件/部署，单文件 25 MiB | 当前构建在限额内；首次离线预缓存需要下载整个应用资源集 |
| D1 | 5,000,000 行读/日，100,000 行写/日，账户总存储 5 GB | 免费单库 500 MB；索引、回执和 tombstone 也占空间/写额度 |
| R2 Standard | 10 GB-month、1,000,000 Class A、10,000,000 Class B/月，公网流出免费 | 超出免费档会按账户设置计费；历史文件版本持续占空间 |
| 模型服务 | 无本应用赠送额度 | 按供应商 token/图像计价，与以上额度独立 |

参考：[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)、[Static Assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)、[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)、[R2 pricing](https://developers.cloudflare.com/r2/pricing/)。价格以供应商最新页面和账号控制台为准；本项目不自动升级付费计划。

## 验证命令

```bash
pnpm typecheck
pnpm typecheck:worker
pnpm test:cloud
pnpm build
pnpm test:browser
```

浏览器测试默认 8790；可用 CLOUD_E2E_URL、AGENTERO_TEST_PASSWORD 指向真实部署。Linux 可设置 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium；否则先 `pnpm exec playwright install chromium`。测试会创建独立前缀的论文/笔记和冲突副本，运行后按测试记录清理。Trace 关闭，避免录入密码。

本地 Worker 使用真实 workerd/D1/R2 模拟环境；协议测试的上游为确定性 HTTP 夹具。浏览器 AI 测试模拟应用 SSE，只验证界面/上下文/持久化，不代表供应商已被真实调用。实际 Cloudflare 和外部学术 API 的结果见 [验收记录](../test/cloudflare.md)。

## 0.13.0 数据迁移

部署前运行 `pnpm db:migrate:remote`，新增 `0003_settings_secrets.sql` 和 `0004_parser_jobs.sql`，保持现有 `ENCRYPTION_KEY` 与 `ACCESS_PASSWORD`。旧AI密文仍可读取。升级后在原设置分区配置独立服务密钥，使用“测试连接”验证；区别与限额见 [网页设置](../frontend/web-settings.md) 和 [PDF解析](../backend/web-parser.md)。

## 0.14.0 Agent 升级

无需新增 SQL 迁移；仍使用 0001–0004，保留现有 Worker Secrets。执行 `pnpm build` 后通过 `node scripts/cloudflare.mjs deploy` 部署。原 Agent 界面、文档工具、Skill 和笔记审核恢复范围见[网页 Agent](../frontend/web-agent.md)。模型调用没有附带服务；请在设置配置并测试自己的 provider/base URL/Key/model。

会话与笔记修改记录作为 `.agentero/agent-sessions/` 和 `.agentero/agent-edits/` 普通文件同步/备份。旧聊天可读取，升级不删除历史。首次登录会下载离线副本；大库初始化耗时随文件数量增长。静态资源保留原 PDF/画布/Markdown 依赖，首次离线缓存约 77 MiB，需等待状态显示 Offline ready 后离线。

## 0.15.0 订阅升级

无需新增数据库迁移或 Secret。`pnpm build` 后部署 Worker 与静态资源，已有数据继续兼容。订阅及全文缓存写入 `.agentero/feeds/`，使用相同 D1/R2/outbox 和备份协议。公开 Feed 抓取不调用模型，也不附带第三方 Key；请求、同步文件、R2 存储与流量计入自己的 Cloudflare 额度。每源保留 200 条，全文按需抓取；历史正文和历史对象 GC 尚未实现，存储会随使用增长。

论文广场在线原站交互需要另外两个独立代理 Worker，配置、密钥、请求额度及浏览器 Cookie 要求见 [web-plaza-live](../frontend/web-plaza-live.md)。未部署代理时 Cool Papers 使用静态缓存预览；ModelScope 不直接嵌入被原站禁止的页面。


## 0.29.0 首页与修复操作

首页展示真实论文/笔记统计、阅读与 Kanban 任务进度、日期时钟，可直接添加和完成待办；同步设置可一键归档相同冲突副本，Doctor 双链修复会验证替换后的实际解析。沿用原 D1/R2 与登录配置，无新增数据库迁移。上线验证记录见 [Cloudflare 验证](../test/cloudflare.md)。

## 0.28.0 思维导图、Kanban 与冲突管理

新增独立 `.mindmap.json` / `.kanban.json` 文档，在文件夹右键菜单新建，沿用离线保存、同步及备份。根目录 `Conflicts/` 改为在同步设置集中比较、恢复，不再出现在工作区文件树与搜索中。

本次无需新增 D1 迁移或 Secret。构建后部署主 Worker 与静态资源，Plaza Worker 保持现有部署。已有标签页需要在保存、同步完成后关闭同站点所有页面并重新打开，以激活新版 Service Worker。具体功能与验证见[可视化文档](../frontend/visual-documents.md)及[冲突管理](../frontend/web-conflicts.md)。

## 0.30.0 链接分享升级

部署本次链接分享代码前运行 `pnpm db:migrate:remote`，应用新增 `0005_shares.sql`，然后构建并部署主 Worker 和静态资源。不需要新增 Secret、R2 桶或限速绑定。分享对象使用现有桶的 `shares/` 前缀，独立于文件同步；管理与接收 API 均禁止缓存。单份上限 16 MiB，关闭删除对象，到期不自动清理。工作区 ZIP 不包含分享记录，服务备份需保留 D1 和 R2 配对数据，详见[链接分享](../frontend/web-sharing.md)。

### 0.31.0 笔记阅读与关联分享

链接分享改为渲染后的 Markdown 阅读页，创建时可逐篇勾选直接关联笔记；关闭后从管理列表隐藏。主笔记和所选关联笔记共用一个独立 R2 快照、密钥、有效期与关闭状态，旧链接保持兼容。无需新增数据库迁移、Secret 或绑定；构建并部署主 Worker 与静态资源即可。

### 0.32.0 LaTeX 轻量预览

`.tex` 编辑器新增正文与公式实时预览，复用 KaTeX，支持离线使用，范围见 [LaTeX 预览](../frontend/latex-preview.md)。无需新增数据库迁移、Secret 或编译服务；构建并部署主 Worker 和静态资源。旧页面需等待新版缓存就绪，再关闭该站点所有标签页并重新打开，以激活新 Service Worker。

### 0.34.0 预览与思维导图完善

已提交的 LaTeX 预览补齐作者附注、参考文献和编号引用；同时包含手绘思维导图分支样式和拖动布局，以及默认保护文件后缀的重命名限制与通用设置开关。最终集成发布包含 `206f4d5a`、`634cb88f`、`c4e75bb5`，使用独立 Git 工作副本构建。无需新增数据库迁移、Secret 或编译服务。

最终完整版本已发布到 `https://agentero-web.minjunkirs.workers.dev`，Worker 版本 `e2b0458f-11f5-4acf-9589-128517a1e2ad`。此前不含重命名限制的中间发布已由此版本覆盖。用户要求直接部署后停止正在进行的浏览器测试，未继续执行发布后测试；生产构建和此前已完成的检查不等同于完整线上交互验收。

### 0.35.0 会议倒计时与重命名显示

首页新增会议截稿倒计时，支持会议搜索、筛选、多选和离线缓存；关闭「允许修改文件后缀」时，重命名隐藏后缀并在保存时自动保留。包含 `a5d63357`、`154faaec` 和 `eccedcb9`，无需新增数据库迁移或 Secret。

已发布到 `https://agentero-web.minjunkirs.workers.dev`，Worker 版本 `625de7d5-7570-4024-956b-4665408331c9`。生产构建（含 TypeScript 检查）通过；按用户要求未运行测试。关闭同站点所有标签页后重新打开，以加载新版 Service Worker。

### 0.35.1 侧边栏文件名隐藏后缀

关闭「允许修改文件后缀」时，侧边栏日常文件标签与重命名输入均隐藏后缀；打开后立即恢复完整文件名。实际文件路径和文件夹名不变，悬停可查看完整名称。复用相同后缀识别逻辑，整体处理 `.mindmap.json` 和 `.kanban.json`。

已发布到 `https://agentero-web.minjunkirs.workers.dev`，Worker 版本 `87946e9d-1dcd-41ed-8f73-cf5a1c946f77`。按用户要求停止类型检查并跳过提交检查与测试，仅执行 Vite 生产打包及部署；无需新增数据库迁移或 Secret。

### 0.36.0 论文笔记入口与 Excalidraw

论文笔记继续保存在 `papers/<论文>/NOTES.md`，现在可展开论文行直接找到。Excalidraw 补齐白板新建入口、图片及共享素材库持久化、文件/PNG/SVG 导入导出、离线字体和串行自动保存，范围与验证见[可视化文档](../frontend/visual-documents.md)。

无需数据库迁移、Secret 或新绑定。仅部署主 Worker 与静态资源；官方素材库安装新增允许访问 `libraries.excalidraw.com`。已有页面需在保存完成后关闭同站点所有标签页再重新打开，以激活新版缓存。

已发布到 `https://agentero-web.minjunkirs.workers.dev`，Worker 版本 `244e441e-67f6-4d10-a60c-c4980feb2d92`。前端/Worker 类型检查、生产构建、相关 28 项单测、论文笔记与 Excalidraw 浏览器回归通过。部署后验证 Service Worker 与中文绘图字体内容和本地构建一致，CSP 及生产登录/会话检查通过。

### 0.36.1 阅读与输入交互修复

统一论文目录与正文文件的笔记联动；Agent `@` 支持悬停浏览嵌套文件；界面缩放滑块在拖动结束后应用；全文译文首次点击打开，复用已译段落并补译剩余页面，原文获得焦点时保持译文可见，双向滚动监听跟随视口重新挂载。

无需数据库迁移、Secret 或绑定变更。旧标签页保存完成后，关闭本站所有标签页并重新打开以激活新版缓存。

已发布到 `https://agentero-web.minjunkirs.workers.dev`，Worker 版本 `13e2c411-dcec-4c90-b60b-b914eed8db4e`，应用代码提交 `b836c6a0` 已推送至 `Weifeng2Wu/CF-Agentero`。前端/Worker 类型检查、生产构建、相关单测及 Biome（既有警告）通过；隔离 Wrangler/Chromium 覆盖论文笔记保存与离线重载、嵌套引用悬停、缩放提交，以及三页全文翻译与反复双向滚动。翻译接口使用确定性响应，真实模型语言质量未在本次回归评估。部署后 Service Worker、绘图字体与本地构建内容一致，CSP、生产登录及会话验证通过。


## 首页会议列表紧凑布局（2026-10-06）

应用提交 `87b140d2` 已部署至 `https://agentero-web.minjunkirs.workers.dev`，Worker 版本 `a355818a-52a3-47f7-9bfa-99d540940ea0`。会议列表移至首页标题与时间之间，移除外层卡片，仅显示名称、截止日期和倒计时。

按用户要求直接复用此前已验证的 `dist-web` 产物，通过 `node scripts/cloudflare.mjs deploy` 发布；本次部署没有重新构建或运行测试，应用版本保持 0.36.1。无需数据库迁移或新增 Secret。已有页面在新版缓存就绪后关闭同站点所有标签页并重新打开，以激活更新。


## 翻译与默认题录服务（2026-10-06）

应用提交 `cd26fd4e`、`21a7e332` 已部署至 `https://agentero-web.minjunkirs.workers.dev`，Worker 版本 `891b016e-2ef6-4d4d-b6a9-edd84b8d0791`。包含翻译渠道配置状态颜色、腾讯/Google 免 Key 默认端点、Zotero 官方 PDF 元数据识别及 Manubot Zotero 题录服务，并修正 PDF 识别文字分组协议。默认题录服务支持关闭和自定义地址。

按用户要求复用此前验证过的 `dist-web`，通过 `node scripts/cloudflare.mjs deploy` 直接上线；本次未重新构建或运行测试。应用版本保持 0.36.1，无新增数据库迁移或 Secret。已有页面待新版缓存就绪后关闭同站点所有标签页再重新打开；以前失败的 PDF 识别任务可在通用设置手动重试。

## Lattiora · 研织品牌上线（2026-10-06）

应用提交 `f2c937d9` 已部署至 `https://agentero-web.minjunkirs.workers.dev`，主 Worker 版本 `4883272c-0f55-4e41-b03c-da03b845f099`。界面、浏览器图标、导出水印和模板改用 Lattiora 品牌，保留 MIT 版权声明和既有数据标识。广场代理同步发布：ModelScope `0d541868-9467-4980-a470-02717d19b592`，Cool Papers `e6927985-c8c3-4a20-981b-ad2f6b7e5e1a`。

复用已通过构建、类型检查及浏览器验证的 `dist-web`，本次没有重新构建或运行测试；分别通过 `node scripts/cloudflare.mjs deploy` 及两个 plaza 配置发布。线上首页返回 HTTP 200，标题为 Lattiora；favicon 与 Service Worker 均返回 HTTP 200，内容与本地已验证产物完全一致。无需数据库迁移或新增 Secret，原访问地址保持不变。已有页面待新版缓存就绪后，保存并关闭本站所有标签页再重新打开以激活更新。


## 0.37.0 科研工作区与统一 Markdown（2026-10-06）

已推送至独立仓库 `Weifeng2Wu/Lattiora`，应用提交 `1535bcbc`；主 Worker 版本 `5ef422f9-7b76-4c26-a342-79b8c8f4532c` 已发布至 `https://agentero-web.minjunkirs.workers.dev`。旧历史保留，使用新仓库 main 的正常快进提交，没有强推。

新增关系图谱、全库语义检索及 Agent 查询、可配置首页组件、天气/专注/最近阅读/闪念胶囊、图片背景与模糊/遮罩。阅读进度按实际浏览页累计，AI 分析单独记录。普通 Markdown 与论文 NOTES 共用编辑、源码/渲染双栏和仅渲染模式；新建文件省略后缀自动补 `.md`，快速打开定位实际笔记。

复用现有 D1/R2、Secrets 和同步协议，无新增数据库迁移或绑定；仅部署主 Worker。发布前完成生产构建、前端/Worker 类型检查、相关 94 项单测及 10 个浏览器场景，详见[验证记录](../test/cloudflare.md)。

线上首页与 `/sw.js` 均为 200，逐字节匹配最终构建；Service Worker SHA-256 为 `19b43e130d3ea074df3039eeb38c2b765d3b91a11f36879d903ab2b12d8526d0`。匿名 session/天气接口 401，登录与已登录 session/变更元数据读取 200；Cookie 带 Secure / HttpOnly。已登录上海天气请求返回 200 和有效温度/天气数据。冒烟没有修改生产笔记、布局或模型配置，没有调用付费模型；交互与离线验收来自隔离本地生产构建。

使用入口：顶栏打开关系图谱/语义检索；首页自定义按钮启用或调整组件和背景。语义检索需在设置配置 Embedding 并主动建立索引，扫描页只显示可提取部分。已有页面在同步和新版缓存完成后，保存并关闭本站所有标签页再重新打开，激活新版本。


## 0.37.1 首页拖动与自适应（2026-10-06）

应用提交 `e192d811` 已推送至 `Weifeng2Wu/Lattiora` 并部署，主 Worker 版本为 `42880079-bc1d-454b-88ad-51cfe99e9ec9`，地址保持 `https://agentero-web.minjunkirs.workers.dev`。无需数据库迁移、Secret 或绑定变更。

首页卡片可通过顶部手柄直接拖动排序，支持键盘、触摸、取消、自动保存和离线同步；13 个组件按实际容器宽度自适应，同排等高，调整日期字号、长城市名、会议倒计时和待办选择器。闪念保存按钮显示 Ctrl/⌘+Enter 提示；天气支持全球城市，部分中文别名需改用英文或当地名称。

前端生产构建与相关检查、5 项单测及 4 个不同的生产构建/Wrangler 浏览器场景通过，详见[验证记录](../test/cloudflare.md)。线上首页和 `/sw.js` 均返回 200，内容与本地构建一致；Service Worker SHA-256 为 `79823c2b9d395d58f8bb74ba9f45ab3f667e78b112f7e6a0b224468a27055613`。匿名 session/天气返回 401，登录、认证 session、存储变更读取及天气请求为 200，Cookie 具备 Secure/HttpOnly。未修改生产文件或布局，也未调用模型。

已打开的页面保存并完成同步后，关闭本站所有标签页再重新打开以激活新版缓存。

## 0.37.2 天气定位（2026-10-06）

应用提交 `ce457015` 已推送至 `Weifeng2Wu/Lattiora` 并部署到 `https://agentero-web.minjunkirs.workers.dev`；主 Worker 版本为 `415b34a5-4296-49a6-b3ca-f25607ca4f18`。天气位置设置增加「使用当前位置」，点击授权后保存约略经纬度，沿用现有天气代理、缓存和设置同步；不会持续追踪。无数据库迁移、Secret 或绑定变更。

生产构建、改动文件 Biome、相关 3 项单测和 2 个浏览器场景通过，详见[验证记录](../test/cloudflare.md#0372-天气定位2026-10-06)。上线后首页与 `/sw.js` 返回 200 且逐字节匹配构建，Service Worker SHA-256 为 `2178d9c35f2368307a4c85a59f701ffc3bb0571fc37959e31a50cc6991c2d2a8`；首页实际响应头包含 `geolocation=(self)`。匿名 session/天气为 401，登录、认证 session、变更元数据和真实天气读取均为 200，Cookie 带 Secure/HttpOnly。没有修改生产布局、笔记或请求真实设备定位。记录时应用提交的 GitHub Actions 尚在等待运行，未将其计作已通过。

使用「首页 → 自定义首页 → 使用当前位置」，浏览器允许后点击「保存布局」；未启用天气组件时先勾选天气。拒绝授权仍可手动选择城市。已有页面保存并完成同步后，关闭本站所有标签页再重新打开以激活新版缓存。
