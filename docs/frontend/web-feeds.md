# 网页订阅

原 `PlazaFeedsView`、订阅右键菜单、虚拟时间线、Markdown 详情和划词/右侧 Agent 交互继续使用。文件树重新显示原 Plaza 节点。Cloudflare 迁移不会把浏览器可用的 RSS 功能归为本机例外。

## 数据与抓取

- 用户粘贴 Feed URL，或使用原 arXiv 分类芯片；支持 RSS 2.0、RSS/RDF、Atom、JSON Feed，以及 HTML alternate 链接发现。原版没有分组、未读或隐藏功能，本次不把这些设想列为已迁移。
- `/api/feeds/fetch` 位于现有登录及同源检查之后。Worker 只取用户指定的公开 HTTP(S) URL，不传登录 cookie、模型 Key 或自定义认证头；拒绝 URL 用户密码、IP/本机域、非标准端口和非法重定向。每次最多 5 跳、20 秒、2 MiB，保留 ETag/Last-Modified 与 304。跨域跳转不转发条件值。
- XML/JSON 和 HTML 正文在浏览器解析，避免原 Rust feed-rs/htmd 依赖。拒绝 XML DTD/entity；HTML 经 DOMPurify 清理后转换为 Markdown，保留标题、列表、引用、表格、代码、链接和公式。原网页脚本不会进入工作台运行。
- 每源保留最近 200 条。首次添加失败或空 Feed 不落订阅。打开面板按原 15 分钟过期规则刷新，批量抓取并发最多 4；手动刷新失败 Toast 并保留已有条目。离线不触发过期自动刷新。

## 离线、同步与导出

每源记录为 `.agentero/feeds/<URL摘要>/subscription.json`，包含标题、置顶、条目、入库状态及条件请求值。全文缓存为同目录 `body-<条目摘要>.json`。它们走现有 IndexedDB、Web Locks、版本校验、outbox、D1/R2 和 ZIP 备份；普通备份包含订阅数据。URL 中的查询 token 也属于订阅数据，请只导入可接受这样备份的 URL。

刷新先取网络，再读取最新本地记录合并，避免回退刷新期间的重命名、置顶或已入库状态。删除与该订阅的本地缓存一起产生 tombstone；晚到的刷新不能重新创建已删除源。两设备并发改同一源时保留 `Conflicts/` 副本，原面板显示同步后的当前版本；本地冲突副本不会伪装成额外订阅。跨设备和标签页的变更更新已打开的原面板。

详情优先使用缓存。博客可从 `article`/`main` 等正文容器抓全文；失败时继续显示 Feed 自带正文或摘要，不宣称成功抓到全文。arXiv/DOI/Nature 链接及 Highwire DOI metadata 可识别为论文；入库按钮使用真实标识符导入结果，只有库中存在论文时才标记已入库。出版商 PDF 下载失败仍保留 metadata，错误通过原通知显示。

## 边界及剩余迁移

Worker 无法访问部署者电脑上的 localhost/FreshRSS，需公开 HTTPS 地址；不复现原桌面的 WAF Cookie 挑战重试，也不登录付费站点。正文抓取依赖站点可访问性及页面结构；Feed/文章里的外部图片不属于本地 PDF/笔记资源缓存，离线不能保证显示。历史正文缓存和同步后端的历史对象尚无自动 GC。

Plaza 外部站点改为浏览器直接 iframe，并保留原外链按钮；CSP 只允许 papers.cool 和 modelscope.cn。是否允许嵌入由外站决定。原桌面自定义协议的导航注入/站内入库按钮尚未迁移，不能把直接 iframe 视为同等功能。GitHub Skill discovery/import、arXiv Daily/Embedding 推荐仍在迁移清单；显示原入口不代表这些消费者已完成。

当前浏览器解析与入库回归使用明确的受控 Feed/metadata 夹具。真实 Cloudflare、真实公开 Feed 与其它外部条件应分别见 [验证记录](../test/cloudflare.md)，不以夹具可解析代替真实网络和站点兼容性验收。
