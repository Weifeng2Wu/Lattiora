# 原版功能迁移审计

基准：官方 https://github.com/poco-ai/Agentero 的 `b6320ce5`（本仓库桌面迁移前提交，与本次核对的官方 main 相同）。审计起点：`7fa1a746`。日期：2026-09-29。

**历史审计起点结论：当时版本只是部分工作流完成迁移，不满足原产品功能与 UI 保留要求。** 以下原有浏览器可支持能力都是本次迁移范围，不能改称“后续按需开发”。用户允许改变的是本机依赖边界，不是删减产品。

状态：保留 = 原组件及已知主流程仍在；部分 = 仅部分接通；缺失 = 删除、空实现或无后端；待核验 = 有源码但尚未证明完整可用；本机替代 = 用户授权更换底层实现。保留不代表所有边缘路径已复测。每项完成后须追加实现及验证证据，不以文件数、测试数作为完成率。

当前能力以 [迁移清单](../deployment/capabilities.md) 为准；下表保留审计起点与后续逐批修复证据，不能把旧状态当作当前缺项。0.27 已接回本次确认的镜像、Translator 和批量任务消费者；真实供应商、多浏览器及大库验收仍有外部条件。

## 结构证据（审计起点）

通过 `git ls-tree -r b6320ce5` 与现有源码逐路径核对：设置目录 41 个文件全部缺失；Agent 组件 38 个缺失 37 个；引导组件 12 个全部缺失；templates 83 个全部缺失。Plaza 9 个组件、翻译 15 个模块仍在，但不能据此判断可用。36 个主题预设仍在，原主题选择界面不在。旧 bindings 有 211 个命令入口，当前兼容命令表 28 个；新 Cloud API 绕过部分命令，不能直接把这个比例视为功能完成度。

## 工作台、文件、论文

| 原能力与证据（基准路径） | 审计起点 | 必须迁移及验收 |
|---|---|---|
| 三栏、Dockview、标签拖拽/分屏/布局；`docs/frontend/workspace.md` | 保留 | 原布局、打开/关闭/定位/重载布局，跨文档拖拽回归 |
| 文件树虚拟根/论文节点、重命名/移动/剪贴/回收站；`docs/frontend/vault-tree.md` | 部分 | 原交互保留；恢复广场节点；离线 CRUD、重连冲突及重命名引用回归 |
| Library 列顺序/宽度/隐藏、表格/卡片、标签/read、metadata；`docs/frontend/library.md` | 部分 | 设置入口、列偏好持久化；EasyScholar 批量标签实际调用 |
| 魔棒多标识符/标题候选、PDF 拖放、多任务/取消；`docs/frontend/paper-import.md` | 部分 | 保留原候选窗；恢复队列、识别、补资源与进度，取消不留下假成功 |
| Semantic Scholar/arXiv 标题搜索、DOI/OpenAlex/PubMed 等识别；`docs/backend/identifier-lookup.md` | 部分 | 当前主要 Crossref/arXiv；按原 provider 管线补适配、去重/错误回退 |
| PDF 后台 metadata 识别、规范目录改名、重复 PDF 合并 | 已接回，本地事务通过；云端事务待补 | 配置识别/重试、原目录命名、完整归档重复资料、链接与标签重映射；跨设备租约与原子移动仍待补 |
| NOTES 模板、自动入库、自动打开笔记、替换标签、并发设置 | 部分 | 恢复设置及每一消费者；模板内容、开关行为实际验证 |
| BibTeX/RIS/JSON 导入导出、文件 ZIP/旧 Vault 转换 | 保留 | 保留大小/条数校验及冲突保留；扩展设置/订阅/Skills 数据的备份覆盖 |
| 全文搜索、快速打开、命令面板 | 部分 | 已缓存 Markdown 搜索；核验命令全部可达、PDF 派生正文索引 |

## 阅读、编辑与双链

| 原能力与证据 | 审计起点 | 必须迁移及验收 |
|---|---|---|
| PDF 阅读/缩放/搜索/书签/选区、文本与区域批注；`docs/frontend/pdf.md` | 保留 | 原工具栏/菜单、保存与导出、重开/离线阅读回归 |
| Figures/Tables/Algorithms/Formulas 版面侧栏及引用定位；`pdf-layout-analysis.md` | 部分 | 算法/UI 仍在，模型加载返回 null；恢复浏览器 ONNX 与 provider 布局数据，不能把整个 ONNX 流程归为本机不可用 |
| 正文解析 local/Paddle/MinerU/VLM API；`src/lib/pdf/layout/settings.ts` | 缺失 | 仅 PDFium 文本+统一 OCR；恢复独立 API、模型/语言/OCR/提示词、异步上传/轮询/结果、失败重试与缓存 |
| PDF 划词、整篇、单页、双栏同步翻译；`docs/frontend/translate.md` | 部分 | 保留原区域/段落缓存算法；恢复选择渠道和完整解析前置流程，确认不会总走统一模型 |
| Markdown Plate/源码/公式/表格/图片/属性/callout/导出；`docs/frontend/markdown.md` | 保留 | 原编辑体验回归；原格式快捷菜单与字号/行距/工具栏设置可用 |
| Excalidraw、CodeMirror 其它文本格式；`workspace.md` | 待核验 | 离线保存/重开、资源引用、导出实际验证 |
| Wiki 补全/双链/反链/嵌入/块引用/文件改名；`docs/frontend/wiki.md` | 部分 | 保留当前浏览器索引；补标题重命名和锚点批量更新，尊重未保存编辑与歧义 |
| References/本地匹配/引用入库/被引扫描 | 缺失/待核验 | 恢复引用抽取、匹配、查询与原侧栏操作，不能仅显示空列表 |
| 网页论文阅读/划词/批注；`docs/frontend/web-view.md` | 部分 | 原 reader 安全内容适配；站点禁止嵌入时清晰外链，不能假称所有网站支持 |
| 阅读热力图/使用统计；`src/lib/activity/api.ts` | 缺失 | 当前 record/list/summary/clear 返回空；恢复本地记录、聚合、清除及隐私设置 |

## 原设置与引导 UI

| 原能力与证据（`src/components/settings/`） | 审计起点 | 必须迁移及验收 |
|---|---|---|
| SettingsContent 侧栏/原卡片/懒加载/键盘导航/快捷键定位 | 缺失 | 复用原版 modal 支持；浏览器替代原生独立窗口，保留分区与样式 |
| 通用：入库端点、树标签/排序、笔记模式、打开行为、导出水印、广场、并发 | 缺失 | 恢复原控件及真实消费者；设备重载与跨设备同步 |
| 外观：36 主题、明暗/系统、背景配色、80–150% 缩放、三类字体、编辑字号/行距/工具栏 | 缺失 | 恢复原预览卡/字体选择/滑条，实时应用、离线重载保持 |
| Agent：默认/模型、个人提示词、响应语言、自动精读、PDF 问答独立模型 | 缺失 | 用统一云 Agent 配置替代 CLI 注册/安装，保留所有文档工作流选项 |
| Embedding：base URL/key/model、Test | 已迁移，真实供应商待验 | 原设置测试按钮、原推荐算法、向量缓存；不内置服务，见 web-recommend |
| 翻译：agentero/google/googleapi/deeplx/huoshanweb/tencenttransmart/DeepL/Azure/Google Cloud/OpenAI-compatible/Agent | 缺失 | 所有原渠道逐项适配/验证；不可用服务如实报错。内置私有凭据不随源码提供，映射部署者所配服务并明确来源 |
| 翻译：各渠道独立 key/region/model、probe、语言/自动划词/双栏、自定义 prompt | 缺失 | 当前 run 忽略 provider 参数、probe 固定 false；服务端加密存储、真实路由、双协议 fixture 验证 |
| 解析：local/Paddle/MinerU、独立 VLM、force OCR/语言/自定义 prompt | 缺失 | 原选择器+真实协议管线；模型/凭据不足与任务失败不得写成功状态 |
| Sync 原界面、连接状态/立即同步/配置 | 缺失 | 用已有 D1/R2 引擎填充原界面；明确由部署固定 Cloudflare 后端，原 WebDAV/S3 目的地另列差异 |
| Doctor：库/catalog/双链/aliases/visual marks 检测与修复 | 缺失 | 恢复浏览器适用检查和原 diff/确认 UI；批量写入前检查脏文档，不能空报健康 |
| 快捷键、关于/版本、更新、诊断日志 | 缺失 | 原展示；浏览器更新与下载诊断代替原生 updater/日志目录 |
| onboarding/feature tour 及从设置重启 | 缺失 | 复用原组件；仓库选择改浏览器工作区与导入，Agent 安装改云服务配置 |
| 设置存储/跨窗同步；`src/lib/settings/store.ts` | 缺失 | `saveSettingsAsync` 不落盘、`initSettingsSync` 空；恢复 IndexedDB/outbox 同步、冲突保留；禁止 Key 落 localStorage/普通备份 |

## Agent、Skills、发现与订阅

| 原能力与证据 | 审计起点 | 必须迁移及验收 |
|---|---|---|
| 原 AgentPanel/Composer/Transcript/历史/模型选择；`docs/frontend/agent.md` | 缺失 | 恢复原组件与交互，以 Worker 统一传输替代 ACP，本机进程例外不适用于 UI |
| @ 文件/广场、$skill、/command、当前文档、选区、批注、图片/截图上下文 | 部分 | 简化对话只接部分上下文；恢复原 token 输入/附件/图片处理与上下文序列化 |
| summary/qa/related_work、手动/自动 paper-reader、语言/个人偏好 | 部分 | 恢复原动作和笔记写入；当前 reader 抛 desktop 错误/自动 reader false |
| 持久会话、编辑重发、发送队列、取消/重试、长消息虚拟化 | 部分 | 保留已有同步存储；恢复原历史和消息操作，刷新/离线可读 |
| 工具/计划/推理展示、结构化提问、笔记 diff Keep/Revert、页/图/节引用 | 缺失 | Worker 文档工具及真实事件映射；供应商无推理/工具能力时如实显示，不造事件 |
| 7 个内置 Skill（acdemic-drawing/agentero-cli/deep-research/idea-evaluator/paper-reader/research-paper-writing/vault-normalizer） | 缺失 | 恢复原知识/reference/assets；本机脚本改成真实可用的网页工具或明确外部操作；不把“普通文本可打开”当作 Skill 接入 |
| GitHub/npx 文本来源 Skill discovery、多选导入、已安装识别 | 公开来源已接回；仍有范围限制 | 原选择窗、固定 SHA、安全下载与原子存储已实现；镜像/私有来源、超大仓库仍见 [web-skills](../frontend/web-skills.md) |
| Plaza：cool-papers/modelscope/skills/feeds/arxiv-rec；`src/lib/plaza/` | 缺失/断路 | 恢复原虚拟节点/分页/选择/导入/AI 上下文，移除 localhost 自定义协议依赖 |
| RSS/Atom/JSON Feed：添加、置顶、重命名、删除、正文阅读、论文入库；`docs/development/plaza-feeds.md` | 缺失 | Worker 拉取、原列表 UI、状态同步和离线缓存，抓取失败真实反馈；基准没有分组、未读或隐藏，不把设想当原功能 |
| arXiv Daily：分类、embedding 推荐、摘要翻译、阅读、入库 | 已接回原 UI | 已读/隐藏/播客不在基准组件实现；排序/入库/离线 fixture 验证，见 web-recommend |
| EasyScholar key/probe/分区与影响因子标签 | 缺失 | 当前 probe false、lookup 抛桌面限制；应为服务端 HTTP 适配，不属于本机例外 |

## 已授权替换的本机边界

本机 shell/终端、SSH/SFTP/远程 Vault、原 ACP CLI 安装与 stdio 进程、loopback Zotero/MCP、本机目录监听、原生 TeX/编译/特定解析二进制、系统托盘/菜单/原生窗口均不能原样在 Worker 执行。保留对应文档/导入导出/外部服务工作流；不得据此删掉 Skills、远程 HTTP 解析、Embedding、翻译、订阅或整块设置。

Zotero 本机数据库导入可通过已有一次性转换/标准题录及附件；Web API 是可行补充。TeX 保留源码、导出并外部编译。同步目的地现为部署绑定 D1/R2（原 WebDAV/任意 S3 配置不等同），这一差异须公开记录。浏览器字体限可用/加载字体，网页内容受站点政策，原内置收费 API 凭据不可凭空恢复。

## 迁移执行与验收门槛

1. 原设置框架、完整外观及安全设置同步。先划分密钥边界再接回输入表单。
2. 翻译/Embedding/解析多 provider，恢复原控件、实际消费者与自定义提示词。
3. 原 Agent UI/Skills/文档工具/精读、订阅/Plaza/推荐。
4. 入库/引用/诊断/引导等余项按此表补齐。
5. 每个原流程在 Chromium 实际操作；离线重启/编辑/重连、两设备并发与冲突副本；类型/构建/必要测试；Conventional Commits。
6. 原有 Cloudflare 真实部署证据只覆盖此前已实现子集。新功能须再部署验证；无真实模型/翻译/解析凭据时只能声明协议 fixture 测试，不能声明供应商实测。免费额度与模型费用独立列出。
7. 最终交付前再对官方基准做一遍完整差异检查：逐路径核对组件、设置与模板，逐入口检查命令与后台消费者，再逐工作流复验。只允许用户明确排除的本机能力；HTTP 服务、浏览器模型、Skills、订阅和原 UI 不能因为当前未接通而排除。列出每一剩余差异及证据，未消除的浏览器可支持缺项不得宣称迁移完成。

## 实现进度

- 审计完成：已核对基准源码、原文档与当前缺失/空实现。下列功能恢复尚未验收，不能把本审计当作迁移完成报告。

### 0.13.0 恢复批次

恢复原设置/外观/引导/导览组件，非密钥设置同步、独立加密服务Key、翻译多渠道、Embedding测试、EasyScholar、诊断及修复、笔记模板与本设备阅读事件；接入Paddle/MinerU异步解析和独立VLM。详见 [网页设置](../frontend/web-settings.md)、[解析任务](../backend/web-parser.md)。

仍未完成：原完整Agent UI和工具循环、Skills、RSS/Plaza及Embedding推荐消费者、精读全部消费者、ONNX版面模型、引文提取/入库识别、Wiki标题改名、重复metadata自动合并。不得因为恢复设置字段就将这些功能勾选完成。

本批验收：本地 Chromium 7 场景及真实 Cloudflare 2 场景通过；32 项新增服务/存储针对性用例通过。部署与外部条件见[验证记录](../test/cloudflare.md#0130-原界面恢复增量验证)。商业解析/翻译/Embedding/模型仍无真实凭据，协议夹具通过不等于供应商生产验收。

### 0.14.0 内置 Agent 恢复批次

恢复原右栏 AgentPanel/Composer/Transcript/历史和原工具、计划、问答、权限交互；以 Worker 双协议工具循环替代本机进程。恢复 7 个网页适配 Skill（原 CLI Skill 替换为文档工具说明），精读后台消费者、文档/图片上下文、PDF 引用定位和 scratch 缓存。新增带 CAS 的笔记写入与持久保留/撤销；会话冲突分支与旧聊天读取。移除未使用的简化聊天界面和本机 Agent 预设。所有模型仍由用户配置；翻译没有默认外部代理，公共渠道也需明确地址。

以上实现与边界见[网页 Agent](../frontend/web-agent.md)。尚未完成的范围仍包括 GitHub Skill discovery/import、RSS/Plaza/Embedding推荐消费者、ONNX、引用提取/识别/合并、Wiki标题改名等，不因接回组件或 Skill 正文而视为完成。原审计中的“笔记 diff Keep/Revert”未在基准 Agent 组件找到对应控件；本批提供持久写入审核与撤销，记录实际行为而不声称复用了不存在的组件。

### 0.15.0 订阅恢复批次

重新接通原 Plaza 节点与 Feeds 面板。RSS/Atom/JSON Feed、HTML alternate 发现、置顶/重命名/删除、条件刷新、正文缓存与论文入库经浏览器验证；订阅进入现有文件同步与备份。修复标识符导入不回调完成结果、初次读取订阅时输入框重挂载丢失草稿、缓存刷新回退当前选择等问题。浏览器覆盖离线重开及两设备修改同一源的冲突保留；Worker/存储边界另有针对性用例。

详见[网页订阅](../frontend/web-feeds.md)。这不等于整个 Plaza 已完成：外部站点直接 iframe 的导航/站内入库与原桌面代理存在差异；GitHub Skill 导入、arXiv Daily/Embedding 推荐等仍需迁移，不能因入口恢复就勾选完成。

### 0.16.0–0.16.1 Skill 来源及用户上传恢复批次

恢复原多选导入弹窗、魔棒/GitHub/skills.sh/npx 来源识别与真实浏览器执行器；固定 Git 提交、保留资源、已有目录保护、原子保存及取消。增加用户 SKILL.md/ZIP 上传入口，离线上传后可立即从内置 Agent 的 `$skill` 菜单选择，离线刷新和联网同步通过真实 Cloudflare 验证。见 [网页 Skill 导入](../frontend/web-skills.md) 与 [验证记录](../test/cloudflare.md)。

公开 GitHub 下载在本地 Wrangler 实测通过，但真实 Cloudflare 出站本次被上游拒绝（本站 429），不能记作通过。镜像/私有来源、超大仓库分页仍未实现。原完整迁移尚余 arXiv Daily/Embedding 推荐、外站导航/入库、ONNX 版面模型、引用抽取/识别/合并、Wiki 标题改名等；最终全量源码比对验收门槛不变。

### 0.17.0 Wiki 已保存标题恢复批次

原标题重命名弹窗及入口接回浏览器执行器。按原 `heading_rename.rs` 规则重写目标、父子路径和已解析入链，保留别名与文档格式，拒绝歧义、未保存编辑、过期快照和规划期间变动。IndexedDB 单事务提供本地多文件原子提交；原 UI/离线重载/恢复同步已在本地生产构建验证。详见 [web-wiki-heading](../frontend/web-wiki-heading.md)。云端多文件原子同步及跨文件冲突合并仍待完成；不将其等同于本地事务。

## 0.18 推荐消费者更新

原 arXiv Daily 与 Embedding 推荐消费者已迁移，修正上述历史欠项。详见 [web-recommend](../frontend/web-recommend.md)，真实付费供应商仍待凭据验证。此前段落为按批记录，不能作为当前功能状态。

## 0.18 原版 ONNX 模型恢复

原 ONNX 模型空实现已替换，真实公开权重、浏览器推理和离线重新加载已验证；原本地分析入口现执行模型而非文本区域占位。具体资源限制、取消与验证范围见 [web-layout-model](../frontend/web-layout-model.md)。引用提取等剩余消费者仍需完成。

## 引用侧栏恢复

原 ReferencesPanel 与 citation hover 已接入浏览器 sidecar，保留顺序/标识符与原引用入库交互。单独明确尚欠反向被引扫描、metadata 识别/合并；不能用正向参考文献解析代替全部引用功能。见 [web-references](../frontend/web-references.md)。

## 阅读热力图消费者修复

复核发现旧 cloud command 并非完全空实现，而是返回缺少 kind、位置与问答权重的简化数据。现已复用原 mark schemas/聚合器修复，接入文件同步失效通知，并关闭页数探测临时 PDF。原 Library 色带在线/离线及远端删除回归通过；见 [web-reading-heatmap](../frontend/web-reading-heatmap.md)。

## 反向被引发现恢复（0.20.0）

恢复基准 `citing-scan-dialog.tsx` 原组件及 Library 右键入口、候选勾选和原批量入库。浏览器移植原 IDF、SPECTER2 背景中心化、库内最近邻 p10 门槛、0.65/0.35 排名及 0.7 MMR。服务地址和可选 Key 在 General 配置，连接测试执行 Graph batch 查询；Key 经既有 Worker 加密存储。缓存通过普通文件同步，离线可打开上次完整结果。详情见 [web-citing](../frontend/web-citing.md)。这不代替 metadata 识别/目录归一/重复合并的剩余工作。

## 资源补全消费者（本批）

发现原 `onDownloadAllMissingAssets` 被设为 undefined，已恢复原菜单及浏览器批量资源实现，移除未使用的 native job 查询/排队和无版本保护 PDF 写入函数。arXiv 源下载/解包、原 Quick Open 文件路径访问及主 PDF 排除 source 插图，见 [web-paper-assets](../frontend/web-paper-assets.md)。原树仅展现 attachments 已与基准核对，未人为改树布局。

## 手动元数据工作流恢复（0.22.0）

原批量 `metadataRefresh` JobCenter 消费者改为浏览器活动；单篇刷新复用同一精确 lookup 与版本保护。Edit metadata 的标题更新恢复原 NOTES 别名/占位 H1 同步，尊重自定义标题/嵌套 YAML，metadata/notes 本地原子写入；标签和已读状态改为受锁保护的字段补丁。重新扫描不再将已有论文的 source/attachments 内 PDF 建成论文。见 [web-paper-metadata](../frontend/web-paper-metadata.md)。自动 PDF 识别/目录归一/重复合并仍需实现，未改为完成。

### PDF recognition 消费者补齐

原 PDF 文件导入的 `recognizePending=false` 已替换为持久化队列；General 的识别 URL/Key/测试连接接入实际 Worker 路由，默认空配置。浏览器 PDFium 替代本地 liteparse，版本保护覆盖在途 PDF 替换与手动 metadata。原后台面板可取消，设置可重试，离线重载恢复已通过浏览器 fixture 验证。自动 canonical rename、重复无损合并与跨设备执行去重仍待完成，见 [实现与限制](../frontend/web-pdf-recognition.md)。

### 识别后目录与重复资料迁移

新增 DOI/arXiv 原目录命名、重复论文稳定主记录和完整附件归档。资料/链接/任务完成本地原子提交、目录占用与未保存源文件保护、任务先于 PDF 同步的等待逻辑已验证。未将单文件 CAS 宣称为云端多文件原子事务；识别服务真实上游仍未验证。

### HTML 阅读器实际消费者修复

发现原 `HtmlViewer` 仍调用 `webProxyAllowHost` / 原生 arXiv URL，之前不能据组件存在判定网页可用。现复用原 viewer/selection/translate/ask 组件，改用 Worker 公共 HTML 抓取、IndexedDB 缓存及 CSP opaque 页面，原桥接移植并增加 iframe source 验证。浏览器验证静态正文、样式、原选区菜单、同站导航和离线重开通过；恶意脚本不执行。外站脚本应用和 Plaza 列表入库仍见 [明确范围](../frontend/web-html-reader.md)。

### Cool Papers 链接导航与入库

已恢复原 Plaza frame 导航按钮、缓存网页内链接和原注入 `[入库]` 控件；非 arXiv 入库的 native JobCenter 断路替换为 Highwire 浏览器解析/去重/原文件持久化/PDF 下载。浏览器原流程与离线重开通过，见 [web-coolpapers](../frontend/web-coolpapers.md)。外站 JavaScript 全部行为、ModelScope 深度导航和应用 Kimi notes 消费者仍未完成，不能据此将 Plaza 总项勾选完成。

原 NOTES 工具栏 Kimi 分析已迁移：公共分析抓取、标题定位、Markdown 追加保护、幂等及离线缓存，详见 [web-coolpapers](../frontend/web-coolpapers.md)。原站动态浮层与 ModelScope 深度导航仍未等价完成。

原移动端列表/顶栏/手势/PDF/Notes/导航 UI 已移植到网页登录和本地文件边界，内置 Agent 复用同一组件；具体原生替代与验证范围见 [web-mobile](../frontend/web-mobile.md)。

原中英 Vault 教程与 thesis 示例、内置模板未修改文件升级及用户修改/删除保护已恢复，见 [web-vault-templates](../frontend/web-vault-templates.md)。TeX 编译仍使用外部服务。

已修复原自动版面分析仍投递 native JobCenter 的消费者断路，恢复打开论文自动分析和全文翻译等待链的浏览器执行入口；见 [web-layout-queue](../frontend/web-layout-queue.md)。

魔棒通用公开网页 URL 已从 Crossref 搜索断路接回元数据/正文提取、论文目录及 HTML 离线缓存；具体支持范围与站点专用适配欠项见 [web-page-import](../frontend/web-page-import.md)。

### 原 Plaza 动态页面代理消费者

已从 `b6320ce5` 两个原代理移植导航/入库桥接，独立 Worker 保留原 Cool Papers / ModelScope 脚本和浏览器存储；实际主应用 iframe 的 ModelScope 论文→详情→返回通过。Cool Papers 的真实代理授权、原入库和离线回退 fixture 通过。公开原站未缓存的动态交互仍需要联网；参见 [web-plaza-live](../frontend/web-plaza-live.md)。

### 0.26 源组件路径复核（2026-09-30）

重新比较 `git ls-tree -r b6320ce5 src/components` 与当前源码，36 个原组件路径不再存在。此数字只用于检查入口，不能作为功能覆盖率。缺失路径分为：

- 原生 OS 文件监听后的外部改名弹窗、SSH/远程 Vault、Zotero sqlite/loopback 迁移同步、坚果云图标：由浏览器文件操作/标准数据导入替代，不能访问原生资源。
- 移动端配对/桌面桥接及多个本机 Agent 选择/聊天 hooks：配对改同站登录，移动阅读仍用原组件；聊天复用统一内置 Agent 面板，不再选择外部 ACP。
- Agent 安装/卸载/自定义本机命令、主机运行时诊断、原生代理引导、Remote Access、独立原生窗口/更新/欢迎壳：按授权移除或替换为浏览器/统一 AI 功能。
- `use-probing-keys`、`button-group`：原辅助实现已被当前探测/界面代码替代或无消费者，路径缺失不等于测试连接功能缺失。

仍须继续核对保留组件的实际消费者：原 GitHub 镜像行目前禁用，公开 Skill 下载器尚未使用镜像；可配置 Zotero Translator Runtime 及 ISBN/PMID 的专用查询尚未接入通用网页提取。不得把这些归类为“只能本机运行”。原生 JobCenter typed wrappers、remote wrappers 仍有死代码，需要以调用链判定后清理，不以返回 unsupported 冒充完成。

原 GitHub 镜像与 Zotero Translator 两个已确认的浏览器消费者欠项现已接回：镜像原设置/回退/探测/Skill下载浏览器测试通过；Translator 原三端点、魔棒/题录导入、Key保存/探测已验证。上节0.26审计起点的“镜像禁用/Translator未接入”不再是当前代码状态。实际外部镜像和服务解析器可用性仍需用户配置后验证。

### 0.27 最终调用入口复核

再次逐行提取原 typed command 并匹配 `commands.*` 消费者：未接入 Cloud handler 的 23 项引用均属于外部 OS 改名修复（3）、SSH/remote Vault/Agent（18）、系统 CJK 字体导出（1）、本机 chktex（1）。它们不是已完成的网页能力；类型契约与部分隔离分支仍保留供原组件使用，桌面运行时和部署链已移除。系统字体导出与 TeX lint 的限制见能力清单，不以捕获错误视为迁移成功。该静态检查不是所有动态行为的等价性证明。原组件路径仍为405个中保留369个，36个移除/替换路径分类见上节。
