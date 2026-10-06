# 网页引用侧栏

基准为 b6320ce5 的 refs 模块与原 ReferencesPanel，继续使用原引用卡片、筛选、文件夹选择、入库及 PDF 引用预览。原来调用已删除 `job_parse_refs_enqueue` 的空路径已替换为浏览器任务；错误通过 Toast 显示，不能将网络失败伪装成空列表成功。

本地优先保留 `.bbl` 的 `\bibitem` 顺序；没有 BBL 时读 TeX/LTX `thebibliography`；再以 BibTeX key 补元数据，没有有序正文时展示 BibTeX 列表。保留原 key/编号，原始 BBL 不猜标题。在线使用 Semantic Scholar references（分页），不可用时回退 DOI 的 Crossref references；通过 DOI/arXiv、标题、原文标题或作者/年份补全已有条目，不乱序、不将一条在线引用重复分配。

库内匹配沿用 DOI → 去版本 arXiv → 规范标题（至少 15 字符）。读取时重新匹配当前论文库；点击原“导入”选择目标文件夹，通过现有魔棒查询/入库回调更新库内状态。引用侧栏及 PDF citation hover 使用同一份数据。

`source/agentero-cite.json` 保留原 schemaVersion 1。源文件/标识符/联网状态构成 SHA-256 指纹；相同输入复用结果。Web Lock 合并并发，提交时在单个 IndexedDB 事务重新检查所有相关源文件与元数据版本；途中编辑源文件会报错并保留旧结果。sidecar 使用原 outbox/CAS/冲突副本/备份语义。离线可解析源文件和读取缓存；没有源文件时联网查询需要 DOI/arXiv。在线补全失败但有本地正文会保留本地解析结果并提示；无本地输入则保留上一版，不写虚假的空成功。

限制：每篇最多 500 个参考文献源文件、合计 8 MiB、5000 条引用；S2 最多 5 页，服务限流/不可达会明确失败或回退。公共引用查询不包含私有服务凭据，也不调用 LLM；付费供应商验证与此无关。没有将缺少引用的 PDF 交给 LLM 猜测参考文献。**反向被引扫描、PDF metadata 识别与重复论文合并仍是独立待迁移项。**

验证：单元测试覆盖 BBL 顺序/BibTeX 补全、inline TeX、原文标题匹配、库内匹配、离线落盘、源文件并发修改、上游失败保留；Worker 测试覆盖 S2 分页、Crossref 回退、非法标识符。实际本地 Wrangler 查询 `10.1038/nature14539` 经 Crossref 返回 103 条引用；S2 成功分页为 fixture，不能记作真实 S2 验证。浏览器验收结果随后记录于部署测试文档。

浏览器主流程通过（本地生产构建 + Wrangler，37.1 秒）：原 PDF References 侧栏显示 BBL/BibTeX 引用，通过原文件夹选择入库并显示库内匹配；断网重启重新展开侧栏仍可读；重连后独立 HTTP 读取确认 sidecar 和被引论文 metadata 都已同步。引用库内匹配在读取时派生，不要求旧 sidecar 中的 localMatch 缓存实时重写。上游 lookup/reference 响应为 fixture，本地解析/存储/同步为真实实现。

0.19.0 真实 Cloudflare 复验：匿名 401，登录后 Crossref 103 条引用返回成功；未写入生产库。最终本地浏览器用例 42.3 秒通过，引用单元/协议测试合计 8 项通过。
