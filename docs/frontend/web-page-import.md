# 魔棒网页入库

原魔棒保留相同输入/完成流程。非 arXiv/DOI 的 HTTP(S) URL 现在走公共 HTML 抓取，不再作为 Crossref 关键词。浏览器读取 Highwire/OpenGraph/标准 meta 与 Readability 文章信息，记录标题、作者、日期、出版物、摘要、DOI/PDF URL 和 HTML 来源；复用原论文目录、NOTES 模板、PDF 下载与同步。

公共 HTML 进入既有离线页面缓存；正文用 Readability + Turndown 转为 PAPER.md，保留代码、链接、表格及支持的数学 HTML。相对链接在提取前按原网页 URL 解析，避免 DOMParser 使用应用地址产生错误链接。原 HTML 阅读器仍使用 opaque 沙箱。抽取不会执行网页脚本。

重复入库按 DOI/arXiv/来源 URL 去重，跨标签通过 Web Lock 串行确认。已有或已删除 PAPER.md 不覆盖、不复活；其他原文件持久化/冲突机制不变。正文生成失败会报错，已经创建的论文可通过再次导入补齐缺少正文。

这是公开静态文章提取，不是通用浏览器登录自动化。付费墙、需要登录或纯客户端生成内容的网站不能保证抓取。原站特定 API 适配（如 OpenReview）仍须按原源逐项核对，不能把通用 metadata 提取标为所有来源完整支持。网页图片/字体不由正文缓存承诺完整离线，PDF 缓存另走原工作流。

原版 `paper/import/sources` 的九类出版社 PDF URL 回退已迁移到 `venue-pdf.ts`：ACL、USENIX、NeurIPS、CVF、ECVA、IJCAI、PMLR、OpenReview、Springer。普通网页和 Cool Papers 元数据缺少 PDF 时补全，补资源入口也可为已有论文回退。已有明确 PDF 地址优先。PMLR 从 v228 使用原站 GitHub 镜像规则；严格校验 hostname，防止原版 substring 匹配误识别相似域名。地址推导不绕过 OpenReview 验证、Springer 付费墙或上游 403，下载失败沿用任务错误/手动 PDF 上传；NDSS、AAAI OJS 不凭页面编号猜测附件。
