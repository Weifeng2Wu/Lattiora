# Cloudflare 网页版验证记录

验证日期：2026-09-29（Asia/Shanghai）。原始验证版本：0.12.0；0.13.0 增量验证见文末。保留原 React 文件树、论文库、EmbedPDF/PDFium、Plate 和 Dockview；本次没有使用替换界面的 Demo。

## 自动化验证

环境为 Linux ARM64、Node.js 22、pnpm 11.5.3、系统 Chromium。生产构建由 Wrangler 本地 workerd 提供，端口 8790；Vite 开发端口为 1420。

| 验证 | 结果与范围 |
|---|---|
| `pnpm typecheck` | 通过，原前端与新增浏览器适配层 |
| `pnpm typecheck:worker` | 通过，Worker 和共享协议 |
| `pnpm exec vitest run --maxWorkers=2` | 166 个文件通过、1 个文件跳过；1,355 个用例通过、5 个跳过 |
| `pnpm lint` | 通过；保留部分既有及测试代码的非阻断警告 |
| `pnpm build` | 通过；静态资源约 75.78 MiB、833 个文件，最大单文件约 23.13 MiB，低于 Cloudflare 25 MiB 限制 |
| 本地 Chromium | 原界面导入 PDF、阅读/批注、正文提取、笔记保存、离线刷新/重新打开 PDF、双设备冲突、ZIP 下载/恢复、右侧 AI 上下文/历史/生成笔记 |
| 真实 Cloudflare Chromium | 同一套浏览器验收，两个独立 browser context 模拟两台设备；AI 回复仍用明确的 SSE 夹具 |

跳过项需要未提供的外部 PDF 样本/ONNX 模型：版面模型 smoke 和真实论文 citation destination 检查。它们不计入已通过结果。退休的 Tauri、ACP、桌面安装、原生 TeX、移动配对专用测试随相应模块删除；原解析/编辑器/布局/路径等算法回归继续运行。

备份导出还会校验条目数量及包含 manifest 的总容量，避免导出超过本应用恢复上限的 ZIP。

生产构建保留上游的大型 WASM 与编辑器资源，存在 chunk 大小及 CSS `::highlight` 兼容性提示；没有把这些警告当作功能验证通过的依据。曾有库筛选性能测试与构建同时运行时超时/超阈值，独立运行和最终完整回归均通过，100 ms 性能阈值未放宽；仅将该基准的整体测试超时改为 15 秒。

## 存储、恢复与安全

`test/cloud-storage.test.ts` 使用真实 Miniflare/workerd、D1 和 R2 实现，以及独立 fake-indexeddb 设备副本，覆盖：

- 未登录 401、写入 Origin 检查、文件大小/路径约束、模型配置加密与浏览器响应去 key。
- R2 不可变对象重传、D1 原子版本判断、同 mutation 幂等回执、响应丢失后重试、读版本变化。
- 上传过程中再次编辑、设备冲突副本、删除冲突、失效登录后保留编辑、工作区 UUID 不匹配时阻止上传。
- Anthropic 与 OpenAI 兼容请求的真实 Worker 出站链路，对本地 HTTP 协议夹具核对 URL、headers、请求体、SSE、翻译和图像 OCR。

`test/cloud-backend-protocol.test.ts` 检查两协议转换、分块 SSE、异常/不完整流和边界；`test/cloud-backup.test.ts` 检查 ZIP 校验失败不部分导入、二进制恢复、冲突保留、重复恢复、文件重命名与 Wiki 引用原子更新、离线标题嵌入。PDF 快问测试还检查流式 checkpoint、失败/停止及阅读器卸载后的最后一段文本保存。

Chromium 离线验收通过浏览器网络开关断网：设备 A 修改并刷新，重新读取 PDF；设备 B 独立登录并修改同一笔记；A 恢复网络后服务器版本留在原路径，A 的编辑留在 `Conflicts/`；随后主动同步副本并验证设备 B 能拉取同一份恢复内容。验证过程没有页面未捕获异常。补测曾因原 PDF 工具栏自动隐藏而无法点击 Analysis；测试改为先将鼠标移入顶部区域，遵循实际用户交互，不使用强制点击绕过遮挡。

提交与构建前扫描了已跟踪/待提交源码和 dist-web，未发现 `.env.cf` 或生产 secret 的明文值。生产 secret 只留在被忽略、权限 600 的 `.dev.vars.production.json` 和 Workers Secrets。设备 IndexedDB 本身不加密，退出仅锁定本地界面，详见部署文档。

## 真实服务与未验证条件

真实部署：[agentero-web.minjunkirs.workers.dev](https://agentero-web.minjunkirs.workers.dev)。D1 `agentero-web`、R2 `agentero-web`，迁移 0001、0002 已应用。最终 Worker version：`b6378567-a812-400e-a12b-591889c8c582`。

已真实验证：Cloudflare 上传/运行、登录 Secure cookie、D1/R2 文件往返、增量同步与跨浏览器冲突、静态资源及离线缓存；Crossref DOI `10.1038/nature14539` 返回 **Deep learning**，arXiv `1706.03762` 返回 **Attention Is All You Need**，相应公开 PDF 下载返回 `application/pdf`（2,215,244 字节）。

**没有真实 Anthropic 或 OpenAI 兼容模型凭据**。两类协议通过 Worker→夹具的集成测试，浏览器 AI 流程使用应用 SSE 夹具；未声称已验证供应商账号、真实模型输出质量、真实 token 账单、扫描 OCR 质量或所有第三方兼容差异。界面不会自动重试付费模型调用。

尚未验证 Safari/Firefox/真实移动设备、大论文库和免费档压力、真实旧 Vault 数据转换；一次性转换器只通过临时 SQLite/PDF/Unicode 笔记样本验证。未实现部分、备份容量、免费额度与原生替代见 [能力清单](../deployment/capabilities.md)、[部署说明](../deployment/cloudflare.md) 和 [Roadmap](../development/web-migration.md)。

## 重现

先构建，再以每个 spec 独立的本地 Worker / D1 / R2 状态运行浏览器回归：

```bash
pnpm typecheck
pnpm typecheck:worker
pnpm exec vitest run --maxWorkers=2
pnpm lint
pnpm build
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium pnpm test:browser:isolated
```

`test:browser:isolated` 可追加一个或多个 `test/browser/*.spec.ts` 路径；自动生成临时配置与测试凭据、迁移本地数据库、等待就绪并在该 spec 完成后关闭进程及清理临时存储。每个 spec 内的多设备和离线场景仍共用该工作区。它拒绝 `CLOUD_E2E_URL` / `AGENTERO_TEST_URL`，不会复用现有服务；也不修改根目录凭据。失败截图和 Worker 日志保留于 `test-results/isolated/<spec>/`，CI 失败时上传诊断附件，保留 7 天，trace 仍关闭。

CI 的 `verify` 运行类型、lint、单元测试并只构建一次；四个独立浏览器任务下载同一构建，按排序后的 spec 文件分片（`BROWSER_TEST_SHARD=1/4` 至 `4/4`），每个文件只运行一次。各分片内仍逐个启动独立 Worker，失败不会取消其他分片，以便一次取得全部诊断。

若已按 [部署说明](../deployment/cloudflare.md) 启动自己的隔离本地 Worker，可继续用 `AGENTERO_TEST_URL=http://127.0.0.1:<端口> pnpm test:browser`。全套测试不应共用长期累积的数据库：云端同步的设置、服务地址、论文和索引来源不会随新的浏览器 context 自动清空。

真实部署测试使用 `CLOUD_E2E_URL` 和 `AGENTERO_TEST_PASSWORD`，密码应从受保护文件读入子进程环境，不打印、不写在命令行参数中。测试默认关闭 trace，避免保留登录请求。独立测试前缀的数据应在验收后定向清理；不可清空已有用户工作区。

## 0.13.0 原界面恢复增量验证

本批恢复原设置分区、37 张主题卡、引导及功能导览，增加独立服务 Key、多渠道翻译、Embedding/EasyScholar 连接检查和 Paddle/MinerU/VLM 解析。完整功能差异仍以[逐项审计](../development/migration-feature-audit.md)为准，尤其 Agent/Skills/订阅尚未完整恢复。

- 全量算法/存储回归：171 个文件通过、1 个跳过，1,384 个用例通过、5 个跳过。后续连接安全补丁另运行针对性测试，不能把旧全量结果视为未运行的新用例结果。
- 最终新服务/设置/解析/诊断/阅读记录回归：6 文件、32 用例通过，包含切换探测地址不能携带旧 Key、远端设置读取不能回退新编辑。
- 前端类型检查及生产构建、Worker 类型检查通过。构建 853 个静态文件，共 75.99 MiB，最大单文件 23.13 MiB。变更文件 Biome 无错误，有非阻断警告；未重写原无关警告。
- 协议夹具核对 Anthropic `/messages`、OpenAI `/chat/completions`、商业/公共翻译请求、向量索引/维度、Paddle multipart 与 JSONL、MinerU 预签名上传与 ZIP。检查草稿测试不保存 Key、服务端密钥 CAS、重复解析幂等、提交不确定时不自动重复计费、ZIP 路径/解压限制、OCR 图像 MIME 和自定义提示词。
- 浏览器发现并修复：新设备设置基线尚未下载就允许编辑；已保存 Embedding Key 被替换后表单仍保留明文草稿；设置读取与写入竞态；导览覆盖已打开的设置，以及快速关闭未保存完成状态。连接测试按钮与自动保存使用不同成功条件。
- 最终本地 Chromium：7 个场景全部通过（6.2 分钟），覆盖 PDF/笔记/AI 主流程、离线重载、两设备文档及设置冲突、37 主题、独立 Key、全部服务卡连接按钮、引导及导览回放。设置冲突断言仅检查本次新建的恢复副本，避免旧测试数据掩盖丢失。
- 最新真实 Cloudflare Chromium：2 个主流程全部通过（2.4 分钟），完成空库首次设置、PDF 缓存阅读、离线编辑/恢复、跨设备冲突同步、ZIP 下载/恢复、AI 上下文与持久化/生成笔记。AI SSE 仍为夹具；设置服务卡/商业凭据仅在本地隔离环境测试。专用 Browser/Summarize 测试文件通过带版本校验的删除清理，历史 R2 对象遵循现有保留策略。

真实 D1 已应用 0003/0004，生产地址不变。完整浏览器验收版本为 `80fa5809-d916-4305-802d-1e00969d690b`；最终 Worker version 为 `b6b2d682-3df5-4dfc-90f0-e469c8bbd77a`，仅补正 AI 探测已保存凭据的空值收窄判断。最终 Worker 类型检查独立通过，相关 7 项解析/模型协议测试复跑通过；真实站点再次验证更换探测地址而未提供 Key 时返回409、未登录返回401，不调用供应商。前端静态构建未改变，未重复整个浏览器套件。真实 HTTPS 冒烟验证登录 Cookie、未登录接口 401、设置响应不含 Key、D1/R2 可读及新接口输入校验。研究站点 HEAD：Baidu、Google、Google Scholar、GitHub、arXiv 可达；Semantic Scholar 返回 403，诊断如实显示失败，不冒充正常。

没有真实商业翻译、Embedding、Paddle/MinerU、Anthropic/OpenAI 模型凭据。解析质量、供应商账号/额度和收费模型实测未验收；真实浏览器 AI 回复仍使用 SSE 夹具。设置测试只在本地 Worker 运行，不覆盖生产服务 Key 或全局偏好。

## 0.14.0 原 Agent 工作流增量验证

本批恢复原 Agent 组件，以统一 Worker 工具循环替换本机 ACP；文档、Skills、图片、权限、会话、精读及笔记审核行为见[网页 Agent](../frontend/web-agent.md)。

- Worker/存储/服务/Agent：11 文件 67 用例通过（此前 66 项基础上增加结构化问答/取消/恢复用例）；精读提示词 4 项通过。原 Agent 算法/会话/引用与 PDF trace：13 文件 152 用例通过；翻译原用例更新为显式地址和用户配置 AI 的契约。
- 两类协议使用实际 workerd、D1 与受控出站 SSE：核对 Anthropic initial input/分段 tool_use、OpenAI tool_calls、图片、工具结果；无配置不外发，截断不交付可执行工具。浏览器 Agent 场景的模型输出仍为 SSE 夹具。
- 笔记保存前保护源码/富文本/画布未保存编辑；修改记录与笔记原子落盘，撤销检查新编辑，取消时保存部分输出且释放待答问题。会话本地 CAS 冲突保留分支、同步产生的冲突历史可列出、旧聊天兼容读取。
- 修复测试中的右栏懒加载状态判断；初始完整缓存 216 个文件实测 20.6 秒，首次登录断言由 20 秒调整到 60 秒。服务卡测试显式填写 endpoint；引导按钮及文案与“无附带 API”要求一致。没有把这些旧断言失败记作通过。
- 最终相关回归合并执行：26 文件、238 用例全部通过；包含原 Agent 152 项与 Cloud/翻译/精读 86 项。`pnpm build`（含前端 tsc）及 Worker 类型检查通过；全库 Biome 无错误，保留既有非阻断警告。当前部署构建包含恢复后的 Vault AGENTS.md，原 CLI 指令已改为实际网页工具边界。
- 离线撤销回归发现同步调度问题：旧上传快照的回执确认后，新删除仍待上传，任务却进入 60 秒空闲轮询。修复为有待发记录时继续处理，运行中收到文件变化也不再被结束调度覆盖；失败仍保持指数退避。真实 workerd/D1 回执丢失与离线删除的自动重试用例通过，存储集成测试共 11 项通过。
- 修复后隔离 Wrangler + 生产构建的 Chromium 整套 7 场景通过（4.5 分钟）：原 PDF/笔记、双设备冲突/ZIP、原 Agent 文档/Skill/图片/写入确认/多轮、离线历史/撤销/重连同步、外观/安全 Key/连接按钮/设置冲突/引导。已跟踪源码与构建产物共 2,141 个文件扫描，无生产密钥明文命中。真实云端验证另记，不以本地通过代替。

本地浏览器验收可用独立数据目录，避免历史测试文件使虚拟文件树和首次下载时间持续增长。生产构建完成后，两个终端分别运行：

```bash
pnpm exec wrangler d1 migrations apply agentero-web --local --persist-to /tmp/agentero-web-e2e-state
pnpm exec wrangler dev --port 8791 --inspector-port 9233 --persist-to /tmp/agentero-web-e2e-state
```

```bash
AGENTERO_TEST_URL=http://127.0.0.1:8791 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium pnpm test:browser
```

`AGENTERO_TEST_URL` 指定本地隔离 Worker；`CLOUD_E2E_URL` 才表示真实云端并跳过会修改服务配置的设置夹具。测试等待已持久保存的会话与目标文件的 outbox 清空，不以最后一段流式文本作为保存完成证据。

0.14.0 已部署到原地址，Worker version `10ae7fce-b406-4045-bee2-dac6cbc2e8c6`，无新增 SQL。真实云端 PDF/笔记/离线恢复/双设备冲突/ZIP 场景通过（1.3 分钟）。同次 Agent 场景在首次登录初始化 60 秒超时，尚未进入对话，不能记作整套通过；独立诊断下载 87 文件用时 36 秒，未返回 API 错误。原 Agent 场景不改断言单独重跑通过（35.2 秒），覆盖持久会话、Skill/图片/文档上下文、确认写入、离线撤销和重连上传。真实供应商仍无凭据，模型输出为明确的 SSE 夹具。

## 0.15.0 订阅恢复验证

- 相关 Cloud/Agent/翻译/精读/Plaza 回归：29 文件、245 用例通过。前端类型/生产构建、Worker 类型检查通过；变更文件 Biome 无错误，保留原命令桥接循环引用及一处非空断言警告。
- 最终 0.15.0 构建含 942 个静态文件，共 76.61 MiB，最大文件 23.13 MiB。使用隔离 Wrangler 的原 PDF/笔记、内置 Agent、订阅 3 个浏览器场景全部通过（5.0 分钟）。设置卡片和连接按钮在 0.14.0 整套 7 场景通过，本批没有更改其配置协议。
- 订阅浏览器回归覆盖 RSS、Atom、JSON Feed、HTML alternate 发现、正文提取/脚本过滤/表格、真实入库回调、置顶、重命名、格式错误不添加、抓取错误保留缓存、离线正文及两设备标题冲突副本。Feed 和论文 metadata 用受控 HTTP 夹具；数据同步真实经过本地 workerd/D1/R2。
- 验证中修复缓存更新回退所选订阅、初次订阅读取使输入框重挂载丢失草稿；修正测试对“已入库”状态文本的定位、等待异步筛选完成，以及为每轮 HTML 自动发现使用独立 URL。没有把失败轮次记作通过。
- 真实部署 Worker version：`3d7a9b4d-0fa4-43f5-956a-f6393560aaa1`，地址不变，无新增 SQL/Secret。真实 Cloudflare 订阅浏览器场景通过（1.8 分钟），包括跨设备和离线恢复；Feed/metadata 响应仍使用测试夹具。源码及构建产物 2,148 文件扫描无生产密钥明文命中。
- 另以真实 Worker 出站请求验证公开网络：BBC RSS 返回 200，24,511 字节有效 XML；arXiv `cs.AI` 超过沿用原版的 2 MiB 限制，返回 413 `feeds.too_large`，不能记作该源成功。未登录返回 401，本机 IP URL 返回 400。本批没有调用付费模型、翻译或解析服务。
- 真实浏览器测试的专用 `Feed-1790697590287` 数据已按明确前缀和版本校验定向清理，共 10 个文件；没有清空生产工作区，历史 R2 对象仍遵循现有保留策略。

## 0.16.0 Skill 导入验证（2026-09-30）

- 恢复原 Skill 多选窗和魔棒来源消费者；公开 GitHub 固定 SHA、附属资源、IndexedDB 原子保存，详见 [web-skills](../frontend/web-skills.md)。没有新增 D1 migration。
- 前端生产构建（含 tsc）、Worker 类型检查通过；相关 Biome 无错误，保留原 commands 循环依赖告警和浏览器测试 Blob 非空断言告警。
- `vitest run test/cloud-skill*.test.ts test/agent-*.test.ts --maxWorkers=2`：15 文件 / 133 用例通过。
- Chromium + 隔离 Wrangler 的原魔棒/原多选窗：仅安装选中 Skill、保留二进制、离线重载验证通过。GitHub 下载响应为 fixture；真实 IndexedDB 和 Service Worker。
- 本地 Wrangler 真实 GitHub 出站：`anthropics/skills/tree/main/skills/pdf` 返回 200，固定 SHA `8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4`，1 候选 / 12 文件；SKILL.md 返回 200 / 8,072 字节。初次提交详情接口因 diff 超限返回 413，已改用不含 diff 的提交列表接口并复验。
- 不代表 GitHub 私有仓库/镜像、全部大型仓库、商业 AI/解析/Embedding 或整个迁移已验收；网页启动/编辑/同步的既有跨设备冲突测试见前节。
- 0.16.0 已真实部署，Worker version `4066426e-e890-44de-b403-d63ff713c740`。线上未登录 Skill discovery 返回 401；登录后该 GitHub 源被上游拒绝，本站返回 429 `skillSourceUnavailable`（GitHub 403/429 均映射此错误）。不能把本地真实 GitHub 成功替代线上出站验收；本次没有写入生产测试 Skill。

## 0.16.1 用户上传 Skill 验证（2026-09-30）

- 魔棒和 Skills 广场提供 SKILL.md/ZIP 文件上传入口，沿用原多选窗及同名保护；不需 GitHub 或模型凭据。该版本无新增 SQL 或 Secret。
- 前端类型/生产构建通过；相关 Biome 无错误。Skill/Agent 回归 15 文件、135 用例通过，增加 ZIP 离线选择保存、重复 Skill 名和路径穿越拒绝。
- 最终生产构建 + 隔离 Wrangler/Chromium：GitHub fixture 多选/离线重载及真实 ZIP 离线上传两场景通过（1.1 分钟）；上传后立即在内置 Agent 的 `$skill` 菜单中可见，离线重载后仍可见。没有在该流程调用模型。
- 已跟踪文件及 dist-web 共 2,155 个文件扫描，无当前生产密码、加密密钥或 Cloudflare Token 明文命中。
- 增加联网恢复同步断言后，本地上传场景再验证通过（33.8 秒）。0.16.1 已真实部署，Worker version `a9c4938d-a80d-4988-8afe-81f18fe24e76`。
- 真实 Cloudflare 上传场景第一次在资源包尚未就绪时提前断网：上传已成功，但尚未加载的 Agent chunk 无法离线获取。修正测试为等待界面 `Offline ready` 后断网，未放宽上传/Agent/重载/同步断言；复验通过（37.5 秒）。验证使用真实浏览器、Worker、D1/R2 和本地 ZIP，未用上传/同步 API fixture。
- 专用测试前缀 `cloud-upload-1790701224602` 未同步至服务器，`cloud-upload-1790701449375` 的 3 个文件已从独立会话读取核实后按精确路径与版本校验删除。未清空生产库；历史 R2 对象继续保留。

## 0.17.0 Wiki 标题重命名（2026-09-30）

- 原标题重命名弹窗接入浏览器事务；父子路径、简写、自引用、别名与 Markdown 链接保留。范围见 [web-wiki-heading](../frontend/web-wiki-heading.md)。无新 SQL、Secret 或外部 API。
- 前端类型/生产构建、Worker 类型检查通过。Wiki 与存储回归 12 文件 / 124 用例通过；随后新增规划期间并发保存用例，标题事务测试共 6 用例通过。相关 Biome 无错误，现有 Wiki/typed bindings 循环依赖路径仍有告警。
- 最终生产构建 + 隔离 Wrangler/Chromium 原导入、原编辑器右键/标题弹窗：离线修改目标及入链、离线重载、联网同步通过（41.6 秒）。云端多文件原子性不在本批支持范围；保留现有单文件 CAS 和冲突副本。
- 0.17.0 已部署，Worker version `c653cf74-2597-4ec6-b13d-70be63374217`。真实 Cloudflare 原编辑器标题重命名、入链更新、离线重载与重连同步通过（51.6 秒）。专用前缀 `Heading-1790704908321` 的目标与来源两个文件已从独立会话读回验证后，按精确路径和版本定向清理。

## 0.18 arXiv Daily

原推荐 UI、加权 Embedding 算法和持久缓存已迁移；边界及 fixture/真实来源验证区分见 [web-recommend](../frontend/web-recommend.md)。未使用真实付费 Embedding 凭据。

## 0.18 本地版面模型

原版 PP-DocLayoutV3 已恢复浏览器执行；真实权重在线/离线推理通过，下载/缓存/上传及设备限制见 [web-layout-model](../frontend/web-layout-model.md)。

0.18.0 已于 2026-09-30 部署至 `https://agentero-web.minjunkirs.workers.dev`，Worker version `ac4fbd40-33e8-4091-a318-51e31bf8f156`。无新增 D1 migration。真实 Cloudflare 浏览器验证通过（约 1.7 分钟）：原 Layout 设置下载权重并推理、离线重启再推理、离线导入 PDF 后从原 Analysis 面板生成非空模型区域及正文。PDF fixture 在断网后创建且测试未恢复网络，因此没有写入生产 D1/R2。匿名模型下载 401；登录后固定 arXiv RSS 200（3,143,241 字符）。此次未调用付费 Embedding/翻译/解析/LLM 服务。

本地最终构建、Worker 类型检查、Cloud 测试 19 文件/96 项通过。新增推荐/ONNX 用例见相应功能文档；构建现有 chunk size/CSS 警告未阻断。推荐协议使用 fixture，真实公共 RSS 与真实 ONNX 权重/推理分别验证，不混作真实 Embedding 验收。

## 引用侧栏恢复

原引用侧栏和源文件解析/在线补全/库内匹配已接通；详细验证与未完成项见 [web-references](../frontend/web-references.md)。

0.19.0 已部署（2026-09-30），Worker version `537c644f-78b6-4d77-9a58-0c31a3316c87`，无新数据库迁移。原引用侧栏最终生产构建浏览器用例通过（42.3 秒），8 项引用存储/协议测试、前端与 Worker 类型检查及构建通过。真实 Cloudflare `/api/references` 未登录返回 401；登录后 `10.1038/nature14539` 经 Crossref 返回 103 条引用。线上复验为只读，没有创建生产 fixture；引用 UI/入库/离线/同步在本地 Wrangler 测试，lookup/reference 上游为 fixture。没有真实 S2 成功请求证据，不声明其真实服务验证通过。预提交钩子发现的测试可选链 lint 错误已修复，相关测试重新通过后完成聚焦提交。

## 0.19.1 阅读热力图

原阅读标注类型/位置/权重和同步失效通知已修复，保留原色带 UI；页数探测关闭临时 PDF。测试范围见 [web-reading-heatmap](../frontend/web-reading-heatmap.md)。

## 本批：反向被引发现

- `test/cloud-citing.test.ts` + `test/cloud-citing-http.test.ts` 首轮 6 项通过：原 IDF/MMR、SPECTER2 门槛、维度拒绝、重复 DOI/arXiv 过滤、种子页复用/离线结果、失败/取消/输入变更保留缓存、服务测试与上游凭据边界。
- `test/browser/citing.spec.ts` 生产构建 + 本地 Wrangler/Chromium 通过（37.4 秒）：原 General 服务测试/保存、Library 右键入口、默认不勾选/勾选、取消、离线刷新重开、恢复联网后实际导入。上游候选与 lookup 为 fixture；IDB/文件同步为真实路径。
- 全套 cloud：24 文件 / 112 测试通过；前端生产构建与 Worker 类型检查通过。
- 本地 Wrangler 真实公开 Semantic Scholar Graph `paper/batch` 连接测试 200（995ms），未使用模型或 S2 私有凭据。尚未声称真实全库扫描、SPECTER2 配额/权限与限流压力通过。
- 0.19.1 首次部署：资源上传后 Wrangler `fetch failed`，未获得成功版本回执；此前 0.19.0 成功上线记录仍有效，后续成功重试另记。

### 0.20.0 实际部署

- Worker `39f03461-c03c-44ab-99cf-79cf4e56c815`，地址 `https://agentero-web.minjunkirs.workers.dev`；包含此前 0.19.1 热力图修复。无新增 SQL 迁移。
- 线上 `/api/citing` 未登录 401；登录后公开 S2 Graph 测试返回 429 `tryLater`，如实提示上游限流。不可将本地公开 S2 200 外推为生产可用或真实全库/SPECTER2 扫描通过。
- 测试未写生产论文或配置；2197 个仓库/构建路径生产凭据扫描 0 命中。
- Conventional Commits：`e7b2e613`（功能）、`cebe736d`（0.20.0）。

## 本批：资源补全与原 Quick Open

- `test/cloud-source-http.test.ts` / `cloud-source-archive.test.ts` / `cloud-paper-assets.test.ts`：3 文件 7 项通过，覆盖真实协议固定路径/响应限额、gzip TAR 与单文件源码、GNU/PAX 路径、危险条目拒绝、重复下载保留修改、取消/metadata 变更拒绝写入。
- `test/cloud-search.test.ts` 与 `viewer.test.ts`：2 文件 9 项通过。修复 Quick Open 原 `vault_search` 消费者未迁移；原纸内源码默认 Markdown 路由改为 CodeMirror，避免源码格式被改写。
- `test/browser/paper-assets.spec.ts`：独立本地 Wrangler 8793 + 生产构建 Chromium 通过（24.7 秒）：原 Library 批量下载菜单、缺 PDF/TeX 补齐、重复执行无下载、Quick Open 文件路径打开原编辑器、断网修改、IDB 保存、离线刷新重开、恢复联网后独立 HTTP 读取到编辑文本。上游 PDF/源码为 fixture，其余本地持久化、同步及 Worker 路径真实运行。
- 本地 Wrangler 真实 arXiv `1706.03762` 源请求 200；1,150,988 字节归档安全解包 23 个文件，其中 10 个 TeX 文件。不代表所有论文有源码或所有归档格式均受支持。
- 最终全套 cloud 检查：28 文件 / 120 测试通过。前端/Worker 类型检查与生产构建通过；源码浏览器验证未依赖真实云账户或付费模型。

### 0.21.0 实际部署

- Worker `d9f0d4fa-6ac1-4751-a8a2-4e743741a524`，地址同上；无新增 SQL。
- 线上 `/api/arxiv-source?id=1706.03762` 未登录 401，登录后 200；1,150,988 字节、23 个文件、10 个 TeX 文件解包通过。测试没有写入生产论文。
- 提交：`ed66505c` Quick Open 修复，`b600a910` 原批量资源和源码编辑，`d5ffa4b3` 版本。

## 本批：手动元数据与笔记标题

- 原 `test/browser/paper-metadata.spec.ts` 生产构建 + 本地 Wrangler 8793/Chromium 通过（24.8 秒）：原 Edit metadata 弹窗断网保存、旧/新别名同时保留、离线刷新、恢复联网、原表头 Refresh metadata 操作和独立 HTTP 读到更新笔记。Lookup 为 fixture；持久化和同步为真实路径。
- 单测检查原占位 H1/URL stem、保留自定义标题/无标题正文/嵌套 YAML，metadata+NOTES 同事务、旧版本拒绝、并发笔记编辑保留、标签与标题并发合并且不改变识别来源。重新扫描源码插图/附件的防伪论文回归另列于同文件。
- 最终 0.22.0 生产构建重跑元数据浏览器流程通过（24.6 秒）；Worker 类型检查通过；cloud 套件 29 文件 / 125 测试通过，其中 metadata 文件 5 项。

### 0.22.0 实际部署

Worker `61598a80-3f43-479a-bd1c-279a754e0ad7` 已部署至同一 workers.dev 地址，无新增 SQL。此批生产部署验证为 Wrangler 成功回执；元数据编辑/离线重开/刷新写入流程在隔离本地库验证，未修改生产用户论文。

### PDF recognition 队列本地验证

- `pnpm test:cloud`：30 文件、131 项通过（新增识别 6 项）。
- `pnpm build`（含前端 TypeScript）、`pnpm typecheck:worker` 通过。
- 独立 Wrangler 8794 + 生产构建：`test/browser/recognition.spec.ts` 通过（26.6 秒），真实 PDFium/IndexedDB/同步，识别上游 fixture。首次测试误认为 Library 一定展开，改为验证实际可见论文标题后通过，没有更改产品树行为。
- 未使用真实识别服务凭据；没有声称识别服务质量、真实成本或云上执行去重已验证。

识别目录/重复资料测试新增：原 DOI/arXiv 命名、链接修复、主论文与两份笔记/源文件完整保留、未保存源编辑器/已占目录保护、任务先于 PDF 同步等待、陈旧任务版本回滚及移动/任务完成同事务。识别测试目前 11 项通过；浏览器增加精确 DOI lookup 和规范目录同步断言（28.6 秒，上游 fixture）。

### 0.23.0 部署验证（2026-09-30）

- `8127ff76` 恢复识别与持久化重试；`6e874357` 恢复目录归一/完整重复归档；版本提交独立。
- Cloud 测试 30 文件 / 136 项通过；最终前端生产构建、Worker 类型检查通过。最终 0.23.0 浏览器识别/离线恢复/DOI 规范目录同步通过（28.3 秒）。
- 已部署 `https://agentero-web.minjunkirs.workers.dev`，Worker `6c1223a8-6dca-4c6a-bc82-acd93f064d52`。没有新数据库迁移（仍 0001–0004）。
- 云端匿名无 Origin 的 POST 被拒绝（403），现有密码登录 200。仅以公共论文标题对原 Zotero 识别 URL 发起一次临时 draft probe，返回本站 502 / `providerError`（上游拒绝），不能宣称真实识别服务验证通过。没有写入生产用户论文或更改生产识别配置，没有任何模型/服务凭据内置。

### HTML 论文阅读本地验证

原 HTML 读取器的两种原生 scheme 与 allow-host 断路已修复。缓存与原 bridge 契约 9 项通过；生产构建 + Wrangler 的 HTML 浏览器测试通过（22.5 秒）：真实 iframe 隔离、恶意 script/onerror 不执行、内嵌 CSS、原 Quick chat 选区入口、同站导航、离线重载。HTML 上游 fixture；尚未宣称任意真实动态站点兼容。

### 0.24.0 部署与真实 HTML 验证

- 已部署 `https://agentero-web.minjunkirs.workers.dev`，Worker `9da26ff9-00f6-482f-ba23-aae188883f1e`；无数据库迁移新增。
- Cloud 测试 31 文件 / 138 项通过，前端构建及 Worker 类型通过。最终构建 HTML + recognition 两项浏览器流程通过（20.8 / 27.8 秒）。
- 真实 Cloudflare 获取 `https://arxiv.org/html/1706.03762v7`：200，188,707 字节 HTML；在独立本地工作区通过原导入/HTML 阅读器打开这篇真实页面，确认标题、40,546 字符正文和 opaque iframe 隔离。没有修改生产论文库。
- 本次证实公共静态 arXiv HTML 可用，不等于任意脚本站点、认证站点、外链资源离线缓存均已验证。

Cool Papers 原列表链接 → 原行内入库 → 真实 IndexedDB/Worker PDF 同步 → 前后退 → 离线重载缓存列表已通过生产构建浏览器测试（25.4 秒，源站/出版 PDF fixture）。初次测试暴露嵌入脚本字符串转义问题，修复并增加两类桥接 JavaScript 的语法检查后重跑通过；不以 TS 类型通过代替运行时验证。

Kimi NOTES 本地验证：`test/cloud-coolpapers-notes.test.ts` 4 项通过；`test/browser/coolpapers-notes.spec.ts` 原工具栏/受控 FAQ/实际 Worker 同步/离线重复导入及重载通过（26.8 秒）。真实公共 Kimi 上游未验证。

`test/browser/mobile.spec.ts` 在本地生产构建 Chromium 390×844 通过（40.5 秒）：实际 PDF 渲染、断网保存/重载、联网 Worker 同步、独立标签页冲突内容保留。非真机验证，非跨设备测试。

Vault 模板：34 个 Cloud 测试文件共 147 项通过；新增安装器 4 项验证未修改升级/修改保留/删除不复活/父路径冲突等。`templates.spec.ts` 在生产构建通过（27.0 秒），原 Quick Open 打开 TeX、离线修改和重载、模板重新播种保留用户修改及真实本地 Worker 同步。

0.25.0 已部署：Worker `b5a39650-f548-4d51-8e92-c1da26f57940`，入口 `https://agentero-web.minjunkirs.workers.dev`。最终版本生产构建、Worker 类型检查通过；移动端/模板浏览器回归分别 46.6/28.3 秒通过。真实云端会话登录 200、登录后 session 200、匿名 changes 401、移动壳资源 200；该探测不等于真机浏览器或真实付费模型验证。D1 迁移仍为 0001–0004。

自动版面队列：新增 2 项队列测试通过；`mobile.spec.ts` 增加打开 PDF 自动生成非空 layout.json 的断言，生产构建通过（约 1.5 分钟），未点击 Analysis。

网页魔棒：`web-paper.spec.ts` 生产构建 Chromium 通过（49.7 秒），验证 Highwire/文章元数据、正文代码/表格/原站链接、重复导入与原 HTML 阅读器离线重载；受控公开页面响应，非真实站点全覆盖。新增 2 项单元验证 URL 路由和已有/已删除正文保护。

### 独立 Plaza 代理（2026-09-30，本地生产构建）

- Cloud 单元套件 37 文件 / 156 用例通过；补充代理错误桥接与 ModelScope PUT 后，代理专测 7/7 通过，Worker 类型通过。
- `plaza-live.spec.ts` fixture：真实本地主登录/代理授权 Cookie，原桥接、网站脚本 localStorage、入库/PDF 同步、去重、前后退、离线缓存通过（28.7s）。HTTP 重定向由测试转换为脚本导航以便 Playwright 替换最终公网内容，授权签发与 Cookie 未 mock。
- 真实公网：本地代理请求 Cool Papers `/arxiv/cs.AI`、ModelScope `/papers`，正文及脚本加载通过，页面脚本错误为零。另用主应用原 ModelScope iframe 打开真实论文、进入详情、返回列表，58.3s 通过；此项不包含真实 arXiv 入库下载或任何付费 API 验证。
- 代理生产部署与生产浏览器验证另行记录，不能由以上本地结果推定。

### 原出版社 PDF 回退（2026-09-30）

前端类型与生产构建通过，Cloud 套件 38 文件 / 160 用例通过。原 Cool Papers 浏览器测试改为无 `citation_pdf_url`、仅 IJCAI 来源地址，验证推导 PDF 请求和实际保存、去重、离线回退；与通用网页魔棒/正文/离线阅读测试共 2/2 通过（2.1min）。9 类源规则使用原 Rust 案例覆盖；不宣称每个出版商真实公网附件都下载成功。

### 0.26.0 核心回归

生产构建、Worker 类型通过；全仓 lint 无错误，282 条 warning / 15 条 info（既存代码及 import cycle 等，不是零警告）。12 个核心浏览器用例首轮 8 通过、4 失败：长流程180秒总时限、Agent未等离线资源就绪、EasyScholar控件不唯一、引导仍定位旧文本区域文案。修正测试后，干净 Wrangler 状态下 PDF/双设备冲突/备份与 Agent/Skills/两轮对话/离线历史 2/2 通过（3.7min），API 卡片41.9s、引导30.4s通过。首轮8个通过项涵盖订阅、移动端（实际自动ONNX）、外观及设置冲突、密钥、Skills来源/用户上传、模板。旧累积测试库的耗时未作为性能验收通过；大库性能仍是限制。浏览器 AI 回复为 fixture，真实双协议由 Cloud 单元协议测试覆盖，不代表付费供应商实测。

0.26.0 已真实部署主 Worker `573c0493-26c9-48ac-9ab6-4b66bef263e4`（D1 仍为0001–0004）。真实 Cloudflare Chromium 验证：匿名 `/api/changes` 401、密码登录200；经页面登录读取线上已保存中文设置后，原主应用内 Cool Papers 和 ModelScope iframe 均加载真实公开内容。早先探测等待英文“Sync now”超时，修正为稳定元素后确认是线上 zh-CN 设置所致，非登录失败。未记录凭据/私有页面截图，也未执行付费模型请求。

### 原 GitHub 镜像消费者

前端/Worker 类型与生产构建通过；Skills HTTP/存储测试7/7通过，覆盖镜像回退/探测/拒绝非预设地址及凭据隔离。浏览器原设置开关/连接测试/Skill多选下载/离线重载通过（29.3s），上游为fixture；不冒充公共镜像真实可用性验证。此批在0.26.0之后，部署版本另记。

共用 provider endpoint 根路径拼接修复：此前把 URL.pathname 先写为空会被 URL 自动恢复为 `/`，随后追加 `/web` 等生成双斜杠。现在一次性赋值；根路径、带子路径、已含 suffix 的测试通过，Translator 新测试实际触发此问题。

### Zotero Translator Runtime

前端/Worker类型通过；Cloud全套41文件/168用例通过，含text/plain `/web`/`search`/`import`、原题录映射、服务地址/凭据隔离、Zotero JSON及扩展格式导入消费者。生产构建的原General卡片/草稿探测/Key掩码/魔棒ISBN/重复入库测试27.7s通过。服务响应使用fixture；无真实自建Translator或付费Key验收。最终0.27构建部署另记。

### 魔棒任务与原生死代码清理

原界面配置并发2后，两条查询通过互相等待的fixture验证实际并发；第一项404时第二项入库完成；任务面板取消第三项触发请求中止，迟到响应未落盘（25.7s通过）。不是只检查调用次数的单元模拟。确认全src无其他消费者后移除原生JobCenter及三类旧导入执行器；前端类型、浏览器任务/识别/自动版面队列16个针对性测试通过。Translator测试清理改为等待设置恢复同步，避免后续用例继承fixture服务地址。

### 0.27.0 最终回归

最终生产构建（包含前端 tsc）、Worker 类型通过；Cloud 套件41文件/168项、后台活动3项通过。全仓lint无错误，277 warning/15 info，未作为零警告交付。Chromium + 本地 Wrangler 生产构建6/6通过（5.1min）：批量并发/部分失败/取消；PDF与笔记离线重载、双设备冲突及备份；Agent文档/Skills工具/写笔记/离线历史；公开Skill镜像下载/离线重载；用户离线上传Skill ZIP；Translator草稿探测/Key掩码/ISBN入库。AI、镜像、Translator上游均为受控fixture；Cloud协议测试覆盖OpenAI分片工具调用和Anthropic tool_use/tool_result及图像，不代表真实付费服务验收。远程D1查询无待应用迁移（0001–0004）。

0.27.0 已部署主Worker `788c522c-0ffc-4034-9495-3a6c215b9f50`，入口 `https://agentero-web.minjunkirs.workers.dev`。部署后真实Chromium检查：匿名changes为401、密码登录200、页面登录后原工作台加载且读取线上zh-CN设置；Cool Papers与ModelScope原iframe均加载真实公开页面。未改变线上服务配置、未写入fixture Key、未请求付费模型。两项独立Plaza Worker沿用0.26部署。操作步骤、费用与恢复说明见deployment/cloudflare.md。

### PDF 批注卡遮挡修复

批注布局17项测试通过；Chromium+Wrangler生产构建原PDF回归通过（2.5min）。新增实际批注输入、1440/1100窗口宽度下卡片尺寸/阅读面板边界/右侧鼠标命中检查、保存后marks内容验证；同一流程继续通过离线重载、双设备冲突与备份。针对修改文件lint无错误（原文件14条warning）。

## 独立思维导图与 Kanban（2026-10-05）

生产构建与本地 Wrangler（隔离 D1/R2，8797）通过 `test/browser/visual-documents.spec.ts`：原文件树新建、节点/分支编辑和撤销、卡片拖动/跨列移动、整列删除恢复、JSON 下载、离线编辑及重载、重新联网同步到第二个独立 Chromium context。相关格式/保存并发单测、类型检查与改动文件 Biome 检查通过；保留原构建体积/CSS 与 import-cycle 警告。说明与范围见[可视化文档](../frontend/visual-documents.md)。本次未部署生产环境。

## 冲突副本管理（2026-10-05）

`test/cloud-conflicts.test.ts` 与文件树回归通过：恢复/编辑/同步/删除冲突、差异选择、版本与未保存编辑保护、原版本归档、事务失败回滚、二进制保护、无效删除标记，以及根目录隐藏和普通同名子目录保留。生产构建 + 本地 Wrangler/Chromium 的 `test/browser/conflicts.spec.ts` 通过文件树/搜索隐藏、同步设置中的比较/恢复及恢复结果同步。详见[冲突副本管理](../frontend/web-conflicts.md)；本次未部署生产环境。

### 0.28.0 实际部署验证（2026-10-05）

- 已部署至 `https://agentero-web.minjunkirs.workers.dev`，Worker 版本 `1c2c2773-3b87-4a83-a3b5-71917703282d`。最终生产构建、Worker 类型检查通过；远程 D1 无待应用迁移，沿用现有 Secrets 与独立 Plaza Workers。
- 线上 `/sw.js` 返回 200，与最终构建逐字节一致，且已替换上一版本；SHA-256 为 `9d95b7ab8f6289509d9debca70bdb8bb8caf4833c5d2b37c6d82e0e2d85d2996`。
- 真实 Chromium 登录线上工作台通过：匿名 `/api/changes` 为 401、登录后 `/api/session` 为 200；设置显示 0.28.0，原文件树的新建思维导图/Kanban 菜单可见，根目录 `Conflicts/` 隐藏，同步设置可打开冲突管理。页面运行错误为零。
- 线上检查仅登录和读取，没有写入生产文件或设置、调用 AI。编辑、拖动、撤销、离线重载与第二浏览器同步由上述隔离本地生产构建测试覆盖。

## 0.29.0 首页、相同冲突处理与双链修复（2026-10-05）

- 针对性单测共 19 项通过：冲突 12 项、Doctor/模板 5 项、首页 2 项。覆盖逐字节二进制比较、删除/空文件/未缓存区分、批次部分失败与事务回滚、陈旧/未保存编辑保护、无效链接整批拒绝，以及真实看板任务写回。最终前端生产构建、Worker 类型检查与改动文件 Biome 检查通过，保留已有非阻断警告。
- 独立本地 Wrangler 8798 + Chromium：冲突列表离线一键处理与恢复同步（48.6s），Doctor 替换编辑自动勾选、候选选择、无效替换拒绝、中文/别名保留和离线修复同步（38.5s）通过。
- 首页首轮操作测试通过后，截图复查发现刷新时 Dockview 可能盖住首页；增加独立显示层级和隐藏层透明度，并补上实际命中/点击断言。最终桌面/390px 手机首页、任务增改、完成/重新打开、离线刷新、原看板文件同步与工作区往返通过（38.1s），截图复查正常。原移动 PDF/自动版面/离线笔记/冲突保留回归通过（1.9min）。同批进程随后被中断，单独重跑思维导图/Kanban 全流程通过（1.5min），包括第二浏览器同步。
- 977 个构建资源，最大 23.13 MiB；生产凭据明文扫描零命中。已部署至 `https://agentero-web.minjunkirs.workers.dev`，Worker 版本 `51d435c1-a187-49bd-8a4f-18ab62cf2b74`。无新增 SQL 迁移，沿用原 Secrets 和独立 Plaza Workers。
- 线上 `/sw.js` 返回 200，与最终构建逐字节一致，SHA-256 为 `6d742eb3223158a0eaf824cfaa6bacc9d6505a01f88f19206c72e68ea6a60036`。
- 真实线上 Chromium 验证通过：匿名 changes 401、登录后 session 200、设置显示 0.29.0；首页标题实际鼠标命中、日期时钟、阅读进度、思维导图/Kanban 新建入口、根目录冲突隐藏及「一键处理相同副本」按钮均正常。页面运行错误零项；只登录/读取，未修改生产用户文件、配置或调用 AI。

## 笔记链接分享（2026-10-05）

- 真实 workerd/D1/R2 分享权限、可选密钥与跨链接限速、服务端到期、关闭及对象删除、来源筛选、不可变导出与请求大小限制通过；连同既有存储和导出 metadata 回归，共 25 项测试通过。
- 生产构建、Worker 类型检查与改动文件 Biome 检查通过。独立本地 Wrangler 8795 + Chromium 的 `test/browser/shares.spec.ts` 通过：现有导出弹窗创建/复制/重新打开管理链接、匿名错误/正确密钥、frontmatter 排除、只读 Markdown、PNG 手机预览、PDF 按页预览和下载、自定义/永久有效期、关闭后的访问拒绝、统一管理入口、离线创建失败提示及离线 Markdown 下载。
- 接收方没有请求工作区 API、创建 IndexedDB 或执行 Markdown 中的脚本文本。PDF 初次使用浏览器内置预览时出现空白，最终复用隔离 PDFium Worker 渲染；最终截图确认 PDF 正文和公式可见，PNG 在 390px 视口不横向溢出。
- 需在部署前应用 `0005_shares.sql`；本次只应用隔离本地迁移，未部署生产环境。分享的范围、到期对象清理及备份边界见[链接分享](../frontend/web-sharing.md)。

### 0.30.0 实际部署验证（2026-10-05）

- 已部署至 `https://agentero-web.minjunkirs.workers.dev`，Worker 版本 `77af1e17-28eb-44d0-a52f-dc5b8ad85285`；远程 D1 已应用新增 `0005_shares.sql`。沿用现有 Secrets、D1/R2 与独立 Plaza Workers。
- 最终前端生产构建（包含 TypeScript）、Worker 类型检查和版本文件 Biome 检查通过。982 个构建资源，最大 23.13 MiB；生产凭据明文扫描零命中，保留既有 CSS/构建体积警告。初次并行命令期间 `tsc` 临时不可用，顺序重跑完整构建成功。
- 线上 `/sw.js` 返回 200，与最终构建逐字节一致，SHA-256 为 `c8a61180011930a8e2f120df014b9c8efb8ee1cbbc27f1b0d355e00a735040b6`。匿名工作区及分享管理 API 均为 401，现有密码登录与登录后 session 为 200。
- 仅使用临时合成 Markdown 快照验证真实 D1/R2：无密钥读取 200、错误密钥 403、正确密钥 200、到期与关闭后读取 404，响应禁止缓存。真实 Chromium 的匿名公开页面可打开无密钥和受保护快照，关闭后刷新显示不可访问；未请求工作区 API 或创建 IndexedDB，页面运行错误零项。
- 两轮验证共 6 个临时快照均经关闭 API 删除 R2 对象，再按精确 ID、临时来源路径和已关闭状态清理 D1 测试记录。未分享或更改生产用户文件、服务配置，也未调用 AI。

## 0.31.0 渲染笔记与关联分享（2026-10-06）

- 前端/Worker 类型检查、最终生产构建和 15 个改动文件 Biome 检查通过。985 个构建资源，最大 23.13 MiB，生产凭据明文扫描零命中；保留既有构建警告。
- `cloud-note-share` 与 `cloud-shares` 共 10 项通过：默认仅主笔记、明确选择直接链接、忽略代码示例、别名与循环跳转、禁止隐式包含更深层笔记、frontmatter 排除、整包密钥/撤销保护、非法快照拒绝，以及全局/按笔记过滤关闭记录。
- 独立本地 Wrangler 8796 + Chromium 生产构建分享流程通过（1.1min）：分享模式无格式选择；关联笔记默认不勾选，按选择发布；正文标题、KaTeX、表格与代码实际渲染，关联跳转/浏览器返回和 390px 页面无横向溢出；无工作区 API 请求、IndexedDB 或脚本执行。桌面创建框和手机正文截图复查正常。
- 同一流程还验证错误/正确密钥、匿名读取、自定义/永久有效期、关闭后刷新/重开两处列表不再出现、访问已关闭链接被拒绝、Home 关闭后通过顶部入口重开，以及离线创建失败提示和原 Markdown 文件下载。

### 0.31.0 实际部署验证

- 已部署至 `https://agentero-web.minjunkirs.workers.dev`，Worker 版本 `6eaf0c05-3b41-4431-b4a1-e0aa3d8c056f`；无新增迁移或 Secret，独立 Plaza Workers 保持原部署。
- 线上 `/sw.js` 返回 200，与最终构建逐字节一致，SHA-256 为 `22f5c00c4f80b08a9642705b74ef67b7620c58c72f121b07c644f37224ac3893`。
- 真实线上 Chromium 与 D1/R2 临时笔记包验证通过：匿名工作区/管理 API 401，登录/session 200；无密钥和正确密钥读取 200，错误密钥 403，到期及关闭后 404。正文、KaTeX 与表格实际渲染，所选关联笔记跳转和返回通过，关闭记录从管理接口隐藏，过期但未关闭记录仍可管理。匿名页无私有 API 请求、IndexedDB 或运行错误，截图复查正常。
- 3 份临时合成分享已全部关闭并删除 R2 对象，按精确 ID/临时来源路径清理 D1 后残留为 0。未分享或修改生产用户笔记、服务设置，也未调用 AI。

## LaTeX 轻量预览增量验证

- `pnpm build`（含 TypeScript 检查）和变更文件 Biome 检查通过；保留既有 CSS highlight 与大 chunk 非阻断警告。新增预览 JS 为 5.90 kB / gzip 2.76 kB，复用已有 KaTeX，没有新增依赖。
- 预览解析、TeX lint 与文本保存相关测试共 3 文件 / 20 项通过；补充未闭合大输入保护后，预览 12 项独立复验通过。覆盖正文/嵌套格式、六种公式入口、嵌套列表、未完成输入、未知命令、HTML 转义与规模限制。
- 生产构建 + 隔离 Wrangler/Chromium 的 `tex-preview.spec.ts` 通过（45.7 秒）：Offline ready 后断网首次加载预览、正文/公式实时更新、未知命令可见、HTML 不执行、收起重开、IndexedDB 源码逐字一致、离线刷新和窄面板上下布局。未部署生产环境；不代表完整 PDF 编译或多文件宏包支持。

### 0.32.0 实际部署

- 已部署至 `https://agentero-web.minjunkirs.workers.dev`，Worker 版本 `e20b0771-98ca-463d-9056-e556f213cda7`。前端生产构建（含 TypeScript）、Worker 类型检查通过，无新增迁移、Secret 或编译服务。
- 线上 `/sw.js` 与最终构建逐字节一致，SHA-256 为 `062a9546debc518f500ba3d70db921ecdfaf98bc89cfb5333968369b947b8ef1`。匿名 API 返回 401，登录接口返回 200。
- 真实 Chromium 新设备验收未完成：脚本先修正了仅建立服务端会话、未执行浏览器本地解锁的登录步骤；随后经真实登录界面进入首次全量同步，300 秒内收到 992 个 API 响应，但页面仍为 Signing in，未进入预览断言。不能将其记为线上交互/离线验收通过；预览交互验证仍以此前隔离 Wrangler 测试为准。本次没有执行线上论文编辑或 AI 调用。

### 0.33.0 思维导图交互优化实际部署

- 已部署至 `https://agentero-web.minjunkirs.workers.dev`，Worker 版本 `3cc152a7-25bc-4686-82b7-14e003c8b0aa`。最终生产构建（含前端 TypeScript）和 Worker 类型检查通过，无新增数据库迁移或 Secret。
- 线上首页与 `/sw.js` 返回 200，内容与最终构建逐字节一致；Service Worker SHA-256 为 `143abb5193751903cec9ba0b26d1b02e921c473521623d64c0de1eed60693fe6`。匿名会话接口 401，登录和已登录会话接口均 200，Cookie 带 Secure / HttpOnly。
- 思维导图交互、撤销、离线刷新和第二设备同步已通过发布前隔离 Wrangler + Chromium 回归，详见[可视化文档](../frontend/visual-documents.md)。本次线上检查为资源与认证接口冒烟，不等同于生产工作区完整浏览器回归。


## 2026-10-06：Lattiora 品牌替换

- `pnpm build`（含前端类型检查）、`pnpm typecheck:worker` 通过；改动文件 Biome 检查通过，保留原有非阻断警告。
- 8 个相关 Vitest 文件、70 项检查通过，覆盖新旧品牌聊天包装兼容、模板安装/用户修改保护、导出 metadata、PDF/广场提示词及广场代理。
- 本地 Wrangler 8802 + 系统 Chromium 完成一次性品牌冒烟检查：登录标题/favicon、首次设置、首页、关于页的 MIT 上游链接、离线刷新、390px 手机 Logo 均通过。已查看登录、关于与手机截图。
- 原 `LICENSE` 与数据存储、缓存、备份及内置 skill/provider 标识保留；此记录仅代表本地验证，不代表生产环境已部署品牌更新。


## 0.37.0 科研工作区、闪念与 Markdown（2026-10-06）

- 前端生产构建（含 TypeScript）、Worker 类型检查通过；全库 Biome 无错误，保留既有非阻断警告。最后修正快速打开的笔记定位与源码模式后的属性保存后，重新完成生产构建、相关 Biome 和笔记浏览器回归。已跟踪文件与构建产物共 2,654 项扫描，当前生产凭据明文零命中。
- 相关单元回归共 14 文件、94 项通过：阅读页集合与版本、索引失效/分片、图谱、向量缓存、引用、首页布局/天气、Agent 协议、标签页和 Markdown 保存状态。没有把这组结果记作全仓库单测通过。
- 生产构建 + 隔离 Wrangler 18976 / 系统 Chromium 共 10 个不同场景通过：原首页看板离线操作；组件/背景/天气离线及第二设备同步；图谱与语义索引、过期结果拒绝和移动端打开来源；实际浏览页累计及隐藏阅读器暂停；原移动阅读/离线笔记/并发编辑；批注热力图；会议倒计时；新建无后缀笔记、三视图和源码保存；闪念草稿与离线笔记；论文 NOTES 定位/离线重载。最终笔记三场景合并复跑全部通过（3.5 分钟）。
- 两个旧测试假设已调整并复验：会议从页面 header 改为组件容器定位；导入 PDF 的实际名称为 `paper.pdf`。NOTES 回归暴露快速打开把文件命中转为论文入口，修正为打开实际文件后保留原定位断言并通过，没有删去失败断言。
- 查看首页、图谱与 Markdown 双栏截图；正文标题、粗体、列表和公式可见。浏览器中的 Embedding/天气响应使用确定性夹具；独立 Open-Meteo 上海实时请求已通过，不代表真实供应商向量召回质量或扫描页 OCR 验收。新语义索引不自动调用 OCR，扫描 PDF 显示部分覆盖。
- 测试只写入独立本地数据库，未修改生产论文、服务设置或调用付费模型。发布后的线上资源与认证冒烟结果另记于部署文档。

### 发布后 CI 与线上冒烟

应用提交 `1535bcbc` 的 GitHub Actions 完成类型和 lint 检查，218 个测试文件 / 1,573 项通过、1 文件跳过；`shell-layout-restore` 在收集阶段因 React mock 缺少 `createContext` 失败。对照初始快照的 CI，确认同一失败已存在。将 React 改为部分模拟、保留未覆盖导出后，该文件的 8 项布局恢复检查本地通过，未修改产品代码或削弱断言。后续全量 CI 以 GitHub Actions 实际结果为准。

0.37.0 线上资源、认证、变更元数据和真实天气冒烟通过；Worker ID 与静态资源校验值见[部署记录](../deployment/cloudflare.md#0370-科研工作区与统一-markdown2026-10-06)。


## 0.37.1 首页拖动与组件自适应（2026-10-06）

- 生产构建（含前端 TypeScript）通过，最终构建 2 分 6 秒；改动文件 Biome 无错误。首页存储/CAS、看板和天气相关 3 文件、5 项单元检查通过。未改 Worker 数据契约，无新增依赖。
- 隔离 Wrangler 18976 + Chromium 共 4 个不同浏览器场景通过：原首页离线看板操作、会议倒计时、自适应布局、直接拖动/键盘排序。全部 13 个组件在小/中/全宽和 320/600/1100px 容器组合中检查无横向溢出、卡片撑满所在行；天气与日期并排时上下边缘对齐，包含长英文城市名、长待办和闪念文本。截图复查正常。
- 拖动场景验证悬停不写入、Esc 取消、鼠标落位后保存、离线重载、移动期间保留闪念草稿、键盘焦点恢复、第二设备同步和 390px 触摸模拟。发现按钮仍处于保存禁用状态时恢复焦点会失败，修正为下一帧恢复，并保留原焦点断言；最终拖动场景复跑通过（2 分钟）。触摸测试采用超过 Chromium 手势阈值的位移，并先断言已进入拖动和目标高亮后松手；不代表真实手机硬件验收。
- Open-Meteo 真实查询 London、Tokyo 均为 200 并返回英国/日本结果，接口未设国家筛选；部分中文别名（如本次“纽约”）无匹配，文档说明可改用英文或当地名称。闪念快捷键仍为输入框内 Ctrl/⌘+Enter，新增按钮提示；没有全局唤起快捷键。

## 0.37.2 天气定位（2026-10-06）

- 前端生产构建（含 TypeScript）通过；改动文件 Biome 通过。首页设置及天气相关 2 文件、3 项单元测试通过。未改存储数据契约、Worker 接口或依赖，`pnpm-lock.yaml` 无根版本字段。
- 生产构建 + 隔离 Wrangler 18976 / Chromium 的 `test/browser/weather-location.spec.ts` 两个场景通过：点击前不定位，授权后保存两位小数坐标并用于天气请求；离线重载显示缓存且不再次定位；真实浏览器拒绝权限后保留原城市；模拟超时保留原城市；关闭再打开弹窗后忽略迟到的成功回调。首次成功场景在登录同步阶段超过 90 秒、尚未进入定位流程，原断言不变重跑通过（1.1 分钟）；拒绝/超时场景首轮通过（1.6 分钟）。
- 浏览器测试使用合成坐标与天气响应，权限授予/拒绝由 Chromium 原生权限机制处理；不代表真实设备定位精度或系统定位服务验收。全部写入隔离本地数据库，无生产布局变更。
- 静态 `Permissions-Policy` 从完全禁用定位改为 `geolocation=(self)`，摄像头和麦克风仍禁用。构建后同步最终 `_headers` 并验证源文件与产物一致，本地 HTTP 响应确认生效；上述浏览器回归使用这一最终配置。线上发布与响应头检查另见部署记录。

## CI 浏览器隔离与交互前置条件（2026-10-06）

首次全量运行 `37467181711` 的类型、lint、1,581 项单测和构建通过，浏览器为 37 通过 / 12 失败 / 2 跳过。修正文件树隐藏后缀下的定位方式、空库不存在的 Library 导航，并显式关闭 Translator 以验证内建 lookup（清空地址会恢复默认服务）。每个 spec 使用独立 Worker/D1/R2，避免共享设置与累积论文影响后续索引和文件树。

隔离后的全量运行 `37475675503` 保留四个失败，并上传了诊断：HTML 与 Cool Papers 测试双击标题时触发复制、仍停留在 Library；元数据与论文 NOTES 测试查找的节点在折叠的 Library 下。改为点击明确的论文行或先展开目录，保留后续渲染、保存、离线和安全断言。本地缩放拖动在取坐标前增加控件可操作性等待，避免弹窗移动期间取得失效坐标。没有以删除用例、增加自动重试或放宽验收断言消除失败；全量最终结果以修复提交对应的 GitHub Actions 为准。
