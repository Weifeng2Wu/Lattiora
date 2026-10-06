# 网页反向被引发现

基准：`b6320ce5` 的 `citing.rs`、`citing-scan-dialog.tsx`。Library 右键「Find citing papers」打开原候选弹窗；默认不勾选，确认使用原 identifier 批量导入流程。

在 Settings → General → Citation discovery 配置 Semantic Scholar Graph API 兼容地址（例如 `https://api.semanticscholar.org/graph/v1`），可选 API Key。默认地址为空，不自动启用外部服务。测试连接发送实际 `paper/batch` 查询。Key 由 Worker 加密到 D1，浏览器持久化只含掩码。SPECTER2 来自 Graph API，不混用用户配置的通用 Embedding 模型；两种向量不可比较。

迁移算法保留：183 天、20 条默认预算；排除引用数超过 2000、零引用、未知种子；DOI/arXiv 归一及库内过滤；`1/log10(citations+10)` 交集权重；归一后背景中心化、最近单篇相似度、库内最近邻 p10 门槛；0.65 权重 + 0.35 相似度排名，150 条池内 MMR λ=0.7。缺失向量时提示，仅按引用交集排序。网络失败保留旧完整结果，不伪造无候选成功。

缓存 `.agentero/citing-scan.json`，按服务地址隔离，种子 ID/引用数未变时复用引用页；离线打开最后结果。它随普通文件同步和备份，冲突保留遵循文件 CAS。扫描可在任务面板取消；页面关闭后可重新运行，已完整写入的缓存保留，不宣称后台扫描能跨关闭继续运行。提交缓存时事务检查所有论文 metadata 和旧缓存的本地版本，拒绝覆盖扫描期间的修改。

规模边界：2000 篇库内论文、10000 个去重候选、单次新抓取 20000 条边、8 MiB 缓存；超出时报错且保留旧结果。原请求 batch 500 改为 100，控制 Workers 有界 JSON；仍最多 8 路引用页并发。每次请求有超时、禁止携带密钥跟随重定向。服务端限流、公开 Graph 服务是否授权 SPECTER2、API 费用和配额取决于用户服务商；Cloudflare 免费额度不提供外部论文服务额度。

验证状态见 `docs/test/cloudflare.md`。无真实付费 S2 凭据；协议 fixture 与真实服务验证分别记录。
