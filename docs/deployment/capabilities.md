# 原功能迁移清单

**此表按当前代码更新，验证范围以验收记录为准；不表示所有原版迁移欠项均已关闭。** 原版基准为 `b6320ce5`，历史增量与剩余差异见 [原版逐项审计](../development/migration-feature-audit.md)。

此表区分可用能力、替代和未迁移能力；原 React 界面继续承载主工作流。参考 [架构](../architecture.md)、[操作说明](cloudflare.md) 和 [验收记录](../test/cloudflare.md)。

| 原功能 | 网页状态与替代 |
|---|---|
| 原三栏、Dockview 标签、多面板/拖动/布局 | 保留组件及设备内布局持久化 |
| Vault 文件树、新建、重命名、移动、剪切/粘贴、回收站 | 浏览器 IndexedDB；跨设备版本同步；不直接访问 OS 任意路径 |
| 论文库、标签、阅读状态、metadata 编辑、筛选 | 按论文 `.paper.json` 保存；与原目录及 PDF/NOTES 配套 |
| PDF 导入、文件拖放、题录导入/导出 | 浏览器选择器；BibTeX/RIS/JSON；PDF 文件签名与大小校验 |
| DOI/arXiv/标题/ISBN/PMID 入库 | 用户可配置 Zotero Translator `/web`、`/search`、`/import`（可选加密 Key、测试连接）；默认 Worker 访问 Crossref/arXiv；标题候选仍用原选择对话框；下载失败保留 metadata，并提示手动导入 PDF |
| PDF 阅读、缩放、页码、搜索、选择 | 原 EmbedPDF/PDFium WASM；已经缓存的文件离线可读 |
| PDF 文本高亮、区域批注、评论、导出批注 PDF | 复用原交互；marks/ 及图片侧车进浏览器存储和同步 |
| Markdown 富文本、源文件、图片、导出 | 原 Plate/CodeMirror；本地保存、冲突副本；浏览器下载 Markdown/PNG/PDF。PDF 导出的中文视觉内容保留，缺少可嵌入 CJK 字体时中文文本层检索有限 |
| 笔记链接分享 | 渲染后的 Markdown 只读快照、逐篇选择关联笔记、匿名阅读、可选密钥和有效期，关闭后从管理列表隐藏；需联网，单份 16 MiB，详见[链接分享](../frontend/web-sharing.md) |
| 独立思维导图 / Kanban（新增） | 普通 JSON 文件；节点/分支、列/卡片编辑与移动、撤销/重做、下载；复用离线保存与文件同步，详见[可视化文档](../frontend/visual-documents.md) |
| Excalidraw 白板 | 原组件与文档持久化；浏览器/外部资源行为仍受 CSP 和该组件限制 |
| Wiki 双链、反向链接、补全、文档/标题/块嵌入、改名更新引用 | 浏览器解析；文件移动与引用更新本地原子提交；遇到歧义不猜测目标。原标题重命名/入链锚点更新已接回，未保存或歧义输入拒绝修改 |
| 全文搜索 | 已缓存 Markdown 的浏览器搜索；PDF 先提取正文；另有原 arXiv Daily Embedding 推荐/向量缓存，不等同于全库向量检索 |
| 冲突副本管理 | 根目录 `Conflicts/` 从工作区与搜索隐藏；同步设置一键归档完全相同副本，有差异时比较/选择文本或二进制版本；原版本进入完整备份，见[说明](../frontend/web-conflicts.md) |
| 首页 | 论文与笔记统计、阅读进度、所选 Kanban 待办与进度、日期时钟；CCF 会议多选及截稿倒计时，会议数据缓存和选择仅在当前浏览器保存；离线任务仍写入原看板文件，见[说明](../frontend/web-home.md) |
| 离线启动、笔记编辑、重连恢复 | 完整应用缓存 + 本地数据；有 outbox、幂等回执、退避、双设备冲突副本；无首次从未访问设备离线启动 |
| 多个本地 ACP Agent | 替换为统一内置 AI；Anthropic/OpenAI 兼容配置、流式/取消/重试、文档/选区/区域上下文、笔记操作、持久化对话 |
| PDF 快捷问答与翻译 | 统一 Worker AI；区域图片先由视觉模型描述/识别，再加入问答上下文；可能产生两次模型请求 |
| PDF 版面 / 正文 / OCR | 原 PP-DocLayoutV3 浏览器 ONNX 下载/缓存/上传/推理；Paddle、MinerU、VLM API 配置/连接测试/任务；自动打开版面分析与识别队列。真实 ONNX 在线/离线通过，付费解析质量待真实凭据验收 |
| TeX 编译与源代码执行 | 源文本编辑与[正文/公式实时预览](../frontend/latex-preview.md)；完整 PDF 在 Overleaf 或本机编译后导入；不在 Worker 执行本机程序 |
| OS shell、终端、SSH/SFTP、远程 Vault、CLI | 已移除部署链和入口；通过标准文件上传/ZIP/BibTeX 交换数据。云端不提供远程执行 |
| loopback Zotero Connector、zotero.sqlite 自动同步 | 不可在纯云访问本机服务；用 Zotero 导出题录及附件。原生 Zotero notes/批注双向同步未实现 |
| Agent / Skills | 原右栏、历史/上下文、内置文档工具循环与持久笔记审核撤销；内置 Skills、公开 GitHub 多选导入、用户 SKILL.md/ZIP 上传、资源同步。Shell、外部 ACP Agent、编译器安装和任意 MCP 进程不保留 |
| Plaza / RSS / 推荐 / 引文 | 原 RSS/Atom/JSON Feed UI、正文缓存/入库；原 arXiv Daily；Cool Papers/ModelScope 独立代理和站内入库；EasyScholar Key/连接测试；原 References、被引候选/扫描界面。外站动态脚本需要联网 |
| 原设置与主题 | 原设置面板、36 主题、背景调色、字体/缩放、个人提示词；多翻译渠道与自定义 endpoint/Key/LLM，所有配置服务有连接测试；服务凭据仅服务器加密保存 |
| 原移动界面 | 原移动论文列表、阅读、笔记、侧滑及导航，共享登录/同步/统一 Agent；Chromium 手机尺寸测试通过，真实手机专项仍待验收 |
| 教程与模板 | 原中英教程/thesis 示例；模板升级只更新未修改文件，保留用户修改/删除 |
| 原生独立窗口、自动更新、平台菜单 | 浏览器标签页、原 Dockview 多面板、Service Worker 版本更新 |
| 备份/恢复 | 校验 ZIP、二进制文件/metadata/批注/对话齐全；恢复冲突保留；目前 256 MiB 总大小限制，尚无自动定时云灾备 |

## 旧 Vault 的一次性迁移

先关闭旧桌面应用，完整备份 Vault。在拥有旧数据的机器用 Python 3.10+ 运行：

```bash
python3 scripts/convert-vault.py /path/to/old-vault /path/outside-vault/agentero.zip
```

转换器只读打开 `.agentero/catalog.sqlite` 并做 SQLite 一致快照，将作者、标签、阅读状态和其他 metadata 转成每论文 `.paper.json`；保留公开目录中的 PDF、Markdown、图片及 marks。然后在网页顶栏“导入 → 恢复备份 ZIP”。原数据不会修改。

隐藏目录（包括旧 runtime 数据、凭据、数据库缓存和回收站）不自动复制；旧 ACP 对话和 Zotero 运行状态不转换。缺失的 catalog 目录、符号链接、过大文件/库会报错停止，不能静默宣称完整迁移。该脚本是可选的一次性数据转换工具，部署和日常使用不依赖 Python。

## 当前边界

- 单人账号、单工作区；没有团队协作、用户隔离、邮件登录、密钥找回。
- 服务端版本冲突以文件为单位，完全相同副本可批量归档，有差异时需手工对比，不自动文本合并。不同设备重命名同时修改子文件时可能保留原路径/冲突副本，需整理目录。
- 所有活动文件最终下载到本机，当前不支持容量无限的按需 R2 文件索引。大库受设备磁盘/内存、D1/Worker 免费配额和备份内存上限影响。
- 浏览器已运行原版面 ONNX，并解析 BibTeX/BBL/TeX 引用；原生编译、任意 CLI/ACP 和 OS 文件监听不提供。外部解析/翻译/模型的质量与费用由用户配置服务决定。
- Cool Papers/ModelScope 通过独立受保护代理运行原站脚本；普通 HTML 阅读器用隔离的静态缓存。付费墙、验证码及上游限流不能保证访问。应用自身 CSP 不开放任意脚本。
- 浏览器主流程验收以 Chromium 为准；Safari/Firefox 和移动触摸专项仍需实际设备验证。

## 0.14.0 Agent 增量

右栏已恢复原 Agent UI 与浏览器工具循环、7 个网页适配 Skill、精读消费者、原历史/上下文、持久笔记审核撤销；详见[网页 Agent](../frontend/web-agent.md)。统一模型与各翻译渠道均由用户配置，不附带服务凭据。GitHub 公开来源和用户 SKILL.md/ZIP 离线上传见 [web-skills](../frontend/web-skills.md)；其余 Plaza/推荐等仍未完成，完整差异以[逐项审计](../development/migration-feature-audit.md)为准。

## 0.15.0 订阅增量

原 Feeds UI 已接入 RSS/Atom/JSON Feed、正文缓存、论文入库、置顶与重命名；订阅与缓存可离线读取、修改、同步和 ZIP 备份，冲突副本保留。具体限制见[网页订阅](../frontend/web-feeds.md)。整个 Plaza 尚未完成，外部站点注入交互、GitHub 镜像/私有来源和 Embedding 推荐仍列在审计欠项中。

## Wiki 标题重命名

原编辑器右键与弹窗已接回已保存标题及入链更新，支持离线操作、本地原子事务与既有同步。歧义、未保存编辑、过期快照和写入失败不会留下半次本地重命名。云端仍按文件 CAS 同步，跨文件冲突可能需要手动整理；详见 [web-wiki-heading](../frontend/web-wiki-heading.md)。

## 0.18 arXiv Daily

原推荐 UI、加权 Embedding 算法和持久缓存已迁移；边界及 fixture/真实来源验证区分见 [web-recommend](../frontend/web-recommend.md)。未使用真实付费 Embedding 凭据。

## 0.18 本地版面模型

原版 PP-DocLayoutV3 已恢复浏览器执行；真实权重在线/离线推理通过，下载/缓存/上传及设备限制见 [web-layout-model](../frontend/web-layout-model.md)。

## 引用侧栏恢复

原引用侧栏和源文件解析/在线补全/库内匹配已接通；详细验证与未完成项见 [web-references](../frontend/web-references.md)。

## 0.19.1 阅读热力图

原阅读标注类型/位置/权重和同步失效通知已修复，保留原色带 UI；页数探测关闭临时 PDF。测试范围见 [web-reading-heatmap](../frontend/web-reading-heatmap.md)。

### 反向被引发现

原 Library 右键入口和候选勾选/入库弹窗已接回，浏览器运行原 IDF + SPECTER2 gate + MMR；General 中配置 Graph API 地址/可选加密 Key，可测试实际查询，默认不预配服务。缓存可离线打开、同步与备份。规模、取消和无向量降级边界见 [web-citing](../frontend/web-citing.md)。

### PDF 和 TeX 源文件补全

原批量下载菜单与单篇/identifier 入库共用缺失资源下载；arXiv 源归档在浏览器安全解包。Quick Open 可按路径打开源文件，原 CodeMirror 支持离线编辑。32 MiB 压缩体、64 MiB 展开体、2000 条目限制及关闭页面/失败行为见 [web-paper-assets](../frontend/web-paper-assets.md)。不提供原生 TeX 编译。

### 元数据编辑与刷新

原编辑弹窗、单篇和表头批量刷新使用浏览器本地事务与版本校验；标题变动同步 NOTES 别名/占位 H1，保留自定义正文和 YAML 属性。批量可取消并保留成功项，不用模糊结果覆盖。详见 [web-paper-metadata](../frontend/web-paper-metadata.md)。

PDF 元数据识别已接回原 PDF 导入：设置完整识别 URL/可选 Key/测试连接、浏览器前五页文字坐标、可恢复任务/取消/失败重试、手动数据和在途 PDF 替换保护。默认不调用服务。目录归一及重复资料完整归档已实现，移动和任务完成为本地原子事务；云端仍按文件同步，跨设备可能重复请求；详见 [PDF 识别](../frontend/web-pdf-recognition.md)。

HTML 论文阅读恢复原选区、翻译和问答控件；公共静态正文/内嵌样式可缓存离线，同站导航可继续阅读。网页运行于 CSP opaque 沙箱，应用账户/Key 不可被网页脚本读取。需要登录/脚本生成正文的外站及外链资源的完整离线缓存尚未等价迁移，见 [HTML 范围](../frontend/web-html-reader.md)。

Cool Papers 支持原列表链接浏览、前后退/刷新、原行内入库按钮及非 arXiv 页面 metadata/PDF 入库和重复检测。浏览过的列表可离线重开。原站自己的 JavaScript 功能尚未全部迁移，见 [Cool Papers 范围](../frontend/web-coolpapers.md)。

原 NOTES 工具栏 Kimi 分析已迁移：公共分析抓取、标题定位、Markdown 追加保护、幂等及离线缓存，详见 [web-coolpapers](../frontend/web-coolpapers.md)。原站动态浮层与 ModelScope 深度导航仍未等价完成。

原移动端列表/顶栏/手势/PDF/Notes/导航 UI 已移植到网页登录和本地文件边界，内置 Agent 复用同一组件；具体原生替代与验证范围见 [web-mobile](../frontend/web-mobile.md)。

原中英 Vault 教程与 thesis 示例、内置模板未修改文件升级及用户修改/删除保护已恢复，见 [web-vault-templates](../frontend/web-vault-templates.md)。TeX 编译仍使用外部服务。

已修复原自动版面分析仍投递 native JobCenter 的消费者断路，恢复打开论文自动分析和全文翻译等待链的浏览器执行入口；见 [web-layout-queue](../frontend/web-layout-queue.md)。

魔棒通用公开网页 URL 已从 Crossref 搜索断路接回元数据/正文提取、论文目录及 HTML 离线缓存；具体支持范围与站点专用适配欠项见 [web-page-import](../frontend/web-page-import.md)。

0.27 补充：公开 Skill 文件直连失败可使用原 GitHub 镜像预设，设置提供连接测试；魔棒批量导入恢复原后台任务进度、并发限制和取消，单项失败不阻断其他项。原生 chktex 不运行；中文可搜索 PDF 导出无法读取操作系统字体，需后续授权字体包支持。标准 Zotero JSON 可本地导入，其他题录格式可由用户配置的 Translator 转换；不等同于 Zotero 桌面数据库/批注同步。

## Excalidraw 单人绘图

补齐图片与共享素材库的文件持久化、新建入口、PNG/SVG/场景导入导出、离线字体和串行自动保存。复用现有文件同步与冲突副本；完整范围见[可视化文档](../frontend/visual-documents.md)。论文笔记保留在 `papers/<论文>/NOTES.md`，现可展开论文行直接找到。
