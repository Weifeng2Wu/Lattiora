# Cool Papers 浏览器链路

原 `PlazaWebFrame` 的前进、后退、刷新、打开原站及原列表中的 `[入库]` 控件保留。导航/入库桥接移植自 `b6320ce5 coolpapers/proxy.rs`，脚本正文经过独立语法测试（TS 无法检查字符串里的 JavaScript），注入按钮文案走 i18n。网页复用 [HTML 阅读器](web-html-reader.md) 的公共抓取、离线缓存和 CSP opaque 沙箱；只接受对应 iframe Window 发来的 `origin=null` 消息。

arXiv 行继续走原魔棒标识符流程。其他行已从不存在的 `jobImportEnqueue` / `paperCoolpapersImport` 改为浏览器后台活动，读取 `papers.cool/{branch}/{id}` 的原 Highwire `citation_*` metadata，保留作者、摘要、日期、出版方、PDF URL 和来源。按来源/DOI 去重，复用已有 PDF/TeX 下载、outbox 和 CAS，不创建新的存储机制。取消及下载失败真实返回，论文已写入但 PDF 失败时仍报告缺 PDF，不伪称完整下载。

已验证原列表链接导航/前后退、站内入库、作者/PDF metadata 流程、实际 PDF 下载/同步、离线重载后重开缓存列表。网页从旧页面切换时不再给新 iframe 暂时装入旧文档，以避免旧页面的导航消息使浏览位置跳回。

当前尚未等价恢复外站自身所有 JavaScript 功能（无限滚动、日历、排序、Kimi 浮层等），ModelScope 仍为原外站 iframe；这些不应当标记为 Plaza 完整迁移。应用笔记工具栏里的 Kimi notes 已接回，见下文。此处只声称已验证的链接浏览与入库，不将静态缓存页面伪装成整个原站脚本运行环境。

## 原 NOTES 分析导入

原工具栏按钮按来源 URL、venue ID、arXiv ID、标题唯一匹配顺序定位公共 papers.cool 分析。固定 Kimi 路由保留原 180 秒冷生成等待，限制目标路径及参数，取消请求会中止上游抓取；不使用或附带模型 Key。此处是原站公开内容导入，用户统一 AI 的配置不受影响。

FAQ 保留 Markdown/数学内容并去除原站推广问题。追加前在本地事务内检查文件版本与未保存编辑，不覆盖用户笔记；成功内容缓存可离线重复使用，重复追加幂等。空分析在线重试可重新请求，不永久命中空缓存。缓存/笔记复用 outbox 同步及备份。

本地生产构建 Chromium 验证原按钮、追加、实际 Worker 文件同步、重复导入和离线重载通过；上游以受控响应验证，未宣称真实公共 Kimi 服务可用。
