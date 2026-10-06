# Zotero 题录服务迁移

原 `TranslatorApi` 的 `POST /web`、`/search`、`/import`（`text/plain` 请求和 Zotero JSON 响应）迁移为登录后的 Worker API。General 内复用已有服务配置卡，新增 Zotero 题录服务的地址、可选 Bearer Key、保存和测试连接。默认启用 Manubot 托管的公共实例 `https://translate.manubot.org`，无需 Key，不在 Worker 中安装 Node/Zotero 原生服务。支持关闭或自定义地址，空地址恢复默认；已有自定义配置保留。

默认情况下，魔棒中的出版社 URL、DOI、ISBN/PMID 使用该服务；普通标题搜索继续使用 Crossref，避免将标题传给只支持标识符的公共 `/search`。自定义服务继续支持原有标题查询；arXiv ID/URL 保留既有专用 API/资源下载链。标题结果保留原候选 UI，确认可用 DOI/URL/ISBN 再入库。服务返回错误、验证码或无有效题录不会伪装成成功，也不静默换成另一个服务。关闭题录服务时继续原公开 Crossref/arXiv 和浏览器网页提取。

Zotero JSON 作者（含机构作者）、DOI、题名、期刊/会议、日期、卷期页、标签与 PDF 附件映射到现有论文 metadata；九类出版社 PDF 回退规则补充缺失附件。标准 Zotero JSON 可本地导入，BibTeX/RIS/Agentero JSON 继续离线解析。未识别的其他题录内容在已配置服务时送 `/import`，文件选择器支持 XML/RDF/EndNote/NBIB；此扩展需启用题录服务并联网，具体格式支持由服务的 Zotero translators 决定。非标准格式不配置服务则明确失败。原 Zotero 本机 SQLite/loopback/运行时状态和原生批注双向同步不因此恢复。

API Key 复用 D1 `settings_secrets` 的 `translator.apiKey` 独立 AES-GCM 槽位及版本校验，普通设置、IndexedDB/outbox 和备份只保存掩码。测试可使用尚未保存的草稿 Key；测试成功后仍需保存才能用于入库。公开无认证服务可不填 Key，需要其他认证协议的自建网关需自行适配。Endpoint 必须通过与模型服务相同的 HTTPS/私网地址校验，不跟随服务端重定向转发 Key。

单次 lookup 至多100项；远程题录导入正文2 MiB、至多1000项，响应4 MiB/60秒限制，超限明确失败。服务可能收费或受限流影响，Workers 只转发请求，不提供免费模型或题录服务额度。测试连接实际执行短 DOI 查询，HTTP 200 但无有效 Zotero 题录不算成功。

验证：Worker协议与字段/地址安全测试、原配置卡草稿探测/密钥保存/魔棒ISBN/重复入库浏览器fixture；Manubot 公共服务已实际验证 DOI 查询及 arXiv 网页识别；自建服务及所有出版社解析器未逐项验收。


2026-10-06 默认服务集成验证：隔离 Wrangler + Chromium 通过默认地址、启用状态、自定义地址与草稿 Key 测试、保存时密钥脱敏及 ISBN 魔棒入库。实际 Manubot `/search` 返回 DOI `10.1038/nphys1170` 的题录，`/web` 返回 arXiv 网页题录；本地 Worker 使用默认服务的 `/import` 成功解析公开 RIS 示例。本轮已部署，版本记录见 [Cloudflare 部署](../deployment/cloudflare.md)。
