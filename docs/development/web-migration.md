# Cloudflare Roadmap / Todo

**当前范围：0.27 迁移已交付，用户确认剩余差异与增强项不再实施。** 下列未勾选项保留为已知限制，不是本轮待办；历史修复过程见 [逐项原版审计](migration-feature-audit.md)。后续按用户反馈修复现有工作流问题。

## 已实现

- [x] 当前代码迁入独立 `Weifeng2Wu/Lattiora` 仓库，以单个初始提交开始；旧提交历史留存于 `Lattiora-history`，保留原 MIT 许可与版权归属。

- [x] 中英文 README 重整为产品介绍、能力与快速开始；详细部署步骤归入部署指南，README 不再承载日常发布记录；仓库更名为 `Weifeng2Wu/Lattiora` 并同步当前入口链接。

- [x] 产品更名为 Lattiora · 研织，替换自绘书页交织 Logo、界面、导出和模板品牌；保留 MIT 归属与旧存储标识，详见[品牌说明](../frontend/branding.md)。

- [x] PDF 元数据识别接入 Zotero 官方默认端点，修正行/文字分组协议；Zotero 题录接入 Manubot 公共默认服务，保留自定义和关闭开关。

- [x] 翻译设置已配置渠道显示绿色，连接测试同步状态；腾讯与 Google 公共翻译预置免 Key 端点，保留自定义地址。

- [x] 全文译文首次点击即显示，等待原文解析并自动补译缓存缺失页；保持译文可见并修复视口延迟挂载后的双向滚动监听。

- [x] 界面缩放滑块仅在结束拖动后应用，拖动中预览百分比并保持控件位置。

- [x] Agent `@` 目录悬停展开嵌套子文件，保留整目录引用与键盘浏览。

- [x] 论文内 PDF/HTML 直接打开、再次打开与恢复标签沿用论文笔记联动，不再只匹配论文目录入口。

- [x] Excalidraw 单人绘图：新建白板、图片和共享素材库持久化、原生导入导出、离线字体、自动保存与重试，复用整文件同步/冲突副本；见[可视化文档](../frontend/visual-documents.md)。

- [x] 论文笔记文件树入口：保留 `papers/<论文>/NOTES.md`，展开论文可直接访问，激活笔记自动定位；见[文件树](../frontend/vault-tree.md)。

- [x] 侧边栏默认隐藏并保护文件后缀，通用设置可开启完整文件名显示与编辑，偏好支持离线保存与同步；见[网页设置](../frontend/web-settings.md)。

- [x] 思维导图手绘交互：自由平移、分支拖动/方向键移动、持久配色与恢复布局，使用 Rough.js 稳定手绘线条；验证见可视化文档。

- [x] LaTeX 轻量预览补齐作者附注、正文脚注、参考文献列表、章节/公式编号与前向交叉引用；见 [LaTeX 预览](../frontend/latex-preview.md)。

- [x] `.tex` 正文与公式轻量实时预览：复用 KaTeX、200 ms 输入更新、离线可用；已随 0.32.0 部署。完整 PDF 编译与多文件宏包展开仍不支持，见 [LaTeX 预览](../frontend/latex-preview.md)。
- [x] 笔记链接分享：直接阅读渲染后的 Markdown，创建时逐篇选择可访问的关联笔记；可选密钥、有效期与统一管理，关闭后隐藏。0.30.0 已应用 `0005_shares.sql`，0.31.0 无新增迁移，见[链接分享](../frontend/web-sharing.md)。
- [x] 首页：真实论文/笔记统计、阅读与所选 Kanban 进度、离线待办增改、日期时钟；见[首页](../frontend/web-home.md)。
- [x] 首页会议倒计时移至「首页」与时间之间，移除外层卡片并采用紧凑列表，仅展示会议名称、截止日期和倒计时，适配窄屏。
- [x] 首页会议倒计时：CCF Deadlines 搜索/等级/领域筛选与多选、时区和多轮截稿、浏览器缓存及离线查看；会议偏好仅保存在当前浏览器，见[首页](../frontend/web-home.md#会议截稿倒计时)。
- [x] 冲突列表一键归档完全相同副本；不同版本继续逐项选择。Doctor 双链编辑自动勾选并验证实际解析，拒绝无效或原样修复。

- [x] 独立文件思维导图与 Kanban：新建、编辑、撤销、JSON 导出，复用离线保存与同步；已随 0.28.0 部署，范围见[可视化文档](../frontend/visual-documents.md)。Markdown 转换、引用知识图谱与协作不在本次范围。
- [x] 思维导图交互优化（已随 0.33.0 部署）：分支配色、就地新增/自动聚焦、子节点与同级节点快捷键、画布拖动、适应视图/定位和折叠数量，详见[可视化文档](../frontend/visual-documents.md)。
- [x] 原文件树、论文库、PDF/Markdown、多面板接入浏览器数据边界。
- [x] 单人密码登录、HttpOnly 会话、CSRF Origin 检查、登录限速、服务端加密模型 Key。
- [x] IndexedDB、Web Locks、本地 outbox、幂等请求、CAS 冲突副本、删除冲突保留、重连退避。
- [x] 应用 Service Worker 全资源缓存、离线启动/编辑/阅读、安全等待更新。
- [x] 统一 Anthropic/OpenAI 兼容 AI、已保存文档/选区/区域上下文、总结/问答/翻译、笔记操作和持久化对话。
- [x] 浏览器 PDF 文本提取与模型扫描页识别；公开学术 metadata 查询及 PDF 下载。
- [x] BibTeX/RIS/JSON、完整校验 ZIP、原 Vault 一次性只读转换器。
- [x] 移除 Rust/Tauri/CLI、原生安装发布及前端 Tauri 包依赖。
- [x] D1 migrations、Wrangler 配置、Cloudflare 真实部署及数据工作流验收。
- [x] 原算法测试继续保留；原生专用测试随模块退休，增加 Worker/存储/协议/浏览器验证。

## 当前剩余项（迁移差异、可靠性增强与外部验收）

- [ ] 大库流式/分卷 ZIP、增量备份、按需下载和磁盘配额 UI。
- [ ] 有安全保留期和引用核验的 R2 历史 blob / D1 回执 GC。
- [x] 冲突比较/合并界面移至同步设置，根目录 `Conflicts/` 从文件树与搜索隐藏，保留原版本归档和备份；已随 0.28.0 部署，见[冲突副本管理](../frontend/web-conflicts.md)。
- [x] Wiki 已保存 ATX 标题重命名及入链重写，保留原编辑器弹窗；本地事务与范围见 web-wiki-heading。
- [ ] 云端多文件重命名原子提交和跨文件冲突合并；单文件 CAS/冲突副本继续保留。
- [ ] 中文可搜索 PDF 导出的本地授权字体包；扫描 PDF 真实模型质量评估。
- [x] PDF metadata 识别、原目录命名与完整归档重复资料（本地原子事务）。
- [ ] 识别任务跨设备执行租约与目录移动的云端多文件原子提交。
- [ ] 多浏览器/真实移动设备、超大文件和免费档 CPU/配额压力测试。
- [ ] 使用真实 Anthropic/OpenAI 兼容模型凭据验证 token 费用、视觉模型和供应商差异。
- [x] 恢复原设置/主题/引导界面、安全设置同步（详见 web-settings；消费者欠项另列）。
- [x] 翻译渠道/独立 Key/模型/提示词、Embedding 连接测试、Paddle/MinerU 与 VLM 解析协议。
- [ ] 真实商业翻译/Embedding/解析服务验收。
- [x] 恢复原 Agent UI、内置 Skills、精读后台消费者和文档工具；双协议、持久会话及笔记保留/撤销。
- [x] 原 GitHub/npx Skill 多选窗、公开来源发现、固定提交下载、用户 SKILL.md/ZIP 离线上传、附属资源与事务保存；见 web-skills。
- [x] GitHub 镜像回退及连接测试、原下载消费者。
- [ ] 私有来源、超大来源分页、精读真实供应商与全部队列/取消边缘路径验收。
- [x] EasyScholar 独立 Key/连接探测，浏览器/D1/R2 诊断、双链/别名/旧批注安全修复、笔记模板。
- [x] 恢复原订阅面板、RSS/Atom/JSON Feed、条件刷新、正文缓存/入库、离线与两设备冲突；见 web-feeds。
- [x] 原 Plaza 外站导航/站内入库、PDF 识别与引文消费者；范围与验证见各 web-* 文档。
- [x] Zotero loopback 以标准 BibTeX/RIS/JSON 导出导入与附件上传替代；Web API 增强另行评估。

不计划在纯 Workers 运行任意 shell、SSH、Tauri、原生 TeX 或本机 ACP Agent。

- [x] 原 arXiv Daily 分类/推荐/刷新/入库，原 Embedding 加权算法、向量缓存、离线结果与重连同步；详见 web-recommend。

- [x] 原 PP-DocLayoutV3 浏览器加载、校验/缓存/上传、设置推理测试与本地分析入口；真实 Chromium 在线/离线推理见 web-layout-model。

- [x] 原 References 侧栏、BibTeX/BBL/TeX 源引用解析、S2/Crossref 补全、库内匹配与原引用入库路径；验证与限制见 web-references。反向被引扫描另列。

- [x] 原 Library 阅读热力图消费者：恢复 mark 类型/位置/问答权重，支持新增/修改/删除同步后的缓存失效及离线读取；见 web-reading-heatmap。

- [x] 恢复原反向被引候选弹窗、配置/连接测试及浏览器排序与缓存；原界面浏览器回归已通过，见 web-citing。
- [x] PDF 元数据识别、目录归一/无损重复归档、原移动 UI、Plaza 导航/导入。
- [x] 最终源组件/实际消费者差异复核；GitHub 镜像和可配置 Zotero Translator 三端点接入，限制见迁移审计。

- [x] 原批量补资源入口、arXiv 源归档浏览器解包、Quick Open 源文件访问、CodeMirror 断网源码编辑与恢复同步；浏览器通过，见 web-paper-assets。

- [x] 原元数据弹窗/单篇和批量刷新消费者，标题→NOTES 别名/H1 同步，本地事务与查询版本保护；标签/已读状态并发字段保护。验证见 web-paper-metadata。

## PDF 识别队列恢复（本批）

已接入原 PDF 导入、General 配置/测试、后台任务取消、持久化任务和失败重试；浏览器 PDFium 提取前五页原识别协议 payload，自动元数据写入检查 PDF/notes/metadata 版本并尊重 manual。离线导入与重载恢复的生产构建浏览器测试通过。见 [web-pdf-recognition](../frontend/web-pdf-recognition.md)。目录归一、重复无损合并、跨设备执行租约仍未完成，不将整项自动导入标记完成。

识别后的目录归一/重复归档已实现：原目录命名、稳定主记录、全部资源保留、链接和标签同步；任务完成与移动本地原子提交。版本冲突及未保存文本不移动。云端单文件 CAS 的中间状态仍需后续事务化。

## HTML 论文阅读消费者

原 HTML 阅读器的 native allow-host 与专用 URL 已移除，原界面接回公共 HTML 下载/离线缓存、选区/翻译/问答桥接和同站导航。浏览器隔离与离线流程通过；外站脚本应用、动态资源离线缓存及 Plaza 入库仍不因此标为完成。见 [web-html-reader](../frontend/web-html-reader.md)。

Cool Papers 原 frame 的链接/前后退/刷新、原 `[入库]` 控件及非 arXiv Highwire/PDF 导入已接回，离线重开缓存列表通过。外站脚本交互、ModelScope 和 Kimi notes 尚余独立迁移，见 [具体范围](../frontend/web-coolpapers.md)。

原 NOTES 工具栏 Kimi 分析已迁移：公共分析抓取、标题定位、Markdown 追加保护、幂等及离线缓存，详见 [web-coolpapers](../frontend/web-coolpapers.md)。原站动态浮层与 ModelScope 深度导航仍未等价完成。

- [x] 原移动端 UI 浏览器迁移：原列表/阅读/笔记/侧滑/导航，网页登录与统一 Agent；生产构建测试见 [web-mobile](../frontend/web-mobile.md)。真实移动设备验收仍单列。

原中英 Vault 教程与 thesis 示例、内置模板未修改文件升级及用户修改/删除保护已恢复，见 [web-vault-templates](../frontend/web-vault-templates.md)。TeX 编译仍使用外部服务。

已修复原自动版面分析仍投递 native JobCenter 的消费者断路，恢复打开论文自动分析和全文翻译等待链的浏览器执行入口；见 [web-layout-queue](../frontend/web-layout-queue.md)。

魔棒通用公开网页 URL 已从 Crossref 搜索断路接回元数据/正文提取、论文目录及 HTML 离线缓存；具体支持范围与站点专用适配欠项见 [web-page-import](../frontend/web-page-import.md)。

Plaza 原站脚本迁移已部署至0.26.0：独立 Cool Papers / ModelScope Workers、六小时登录授权和原版注入脚本已接入，具体部署与限制见 [web-plaza-live](../frontend/web-plaza-live.md)。本地原站/离线回归以及真实 Cloudflare 主应用 iframe 加载通过；未缓存的原站动态功能仍需联网。

原九类出版社确定性 PDF 地址补全已从 Rust sources 移植至公共网页/Cool Papers/补资源三个消费者；仍需区分通用题录提取与 Zotero Translator 的站点特定解析，见 [web-page-import](../frontend/web-page-import.md)。

原 GitHub 镜像行已从 native-only 禁用恢复：用户启用后公开 Skill 文件直连失败回退原预设镜像，并有真正访问镜像的连接测试。GitHub metadata API 仍直连；私有本机 Git 凭据、超大来源分页单列。原设置/入库/离线浏览器测试通过，见 [web-skills](../frontend/web-skills.md)。

Zotero Translator Runtime `/web`、`/search`、`/import` 已迁移至可配置 Worker 服务，含原魔棒候选流程、ISBN/PMID、可选加密 Key 与草稿测试；标准 Zotero JSON 本地映射及扩展题录远程导入已接回。已内置 Manubot 公共默认地址；实际站点 translators 与自建服务凭据验证属于外部条件，见 [web-translator](../frontend/web-translator.md)。

魔棒网页分支已恢复原任务面板、同类并发上限与取消，批次某项失败不再阻止其他项。查询/下载接收取消信号；已经提交的metadata不因取消被删除。移除了无消费者的Rust JobCenter桥接、原生导入执行器及包装函数；浏览器任务/持久识别/文件同步保留。

## 阅读批注卡修复

缩小默认批注卡与空白编辑框，折叠入口使用方形图标；卡片按所属PDF面板可见边界定位，面板缩窄及横向滚动时自动移回可见范围，避免被相邻笔记/Agent面板遮挡。

## 部署文档入口

- [x] 中英文 README 增加 Deploy to Cloudflare 按钮和向导教程、必填 Secret 示例、D1 迁移命令及广场独立部署说明。
- 发布按钮须指向已推送的网页版本公开仓库；向导复制仓库/首次资源创建不以现有手动部署验证代替。

部署按钮目标已指定为公开仓库 `Weifeng2Wu/Lattiora`；保留原MIT版权和完整LICENSE，中英文README注明来源与衍生版本身份。

## 科研工作区增强（0.37.0）

- [x] 论文/笔记关系图谱，复用已解析双链与文献引用，支持搜索、邻居聚焦和离线查看。
- [x] 全库语义检索与 Agent `semantic_search`，显式增量索引、来源版本校验、页码/片段返回。
- [x] 首页元素组件化，开关/排序/尺寸；天气、专注计时、最近阅读；布局和图片背景/模糊/遮罩同步。
- [x] 按实际浏览页累计阅读覆盖，跨设备合并；AI 精读完成独立记录，保留手动已读。
- [x] 闪念胶囊：可选首页组件、草稿保留、快捷保存、普通 Markdown 笔记及离线同步。
- [x] 新建文件省略后缀默认 Markdown；根据存储条目判断文件/目录；普通笔记与 NOTES 共用编辑/双栏/仅渲染视图。
- [ ] 大规模论文库索引吞吐、真实供应商向量召回质量、扫描页 OCR 覆盖和真实移动设备验收。
