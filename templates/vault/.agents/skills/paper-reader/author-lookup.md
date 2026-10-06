# 作者信息与外链检索

为论文补齐**可联系入口与外部链接**：一作与通讯作者的 email / 个人主页 / GitHub，以及该
论文的 **OpenReview** 页面。每条结果都要**给出来源**；查不到就留空，绝不臆造邮箱、主页或账号。

## 输入（Lattiora vault）

- 目标是 `papers/` 下的**论文文件夹**（Vault 相对路径，如 `papers/1706.03762`）。
- 先读本地资料，拿到检索线索（标题、作者、DOI、arXiv id）：
  1. 本地 PDF：首页作者块常带 email 与机构；通讯作者常标 `*` / `†` / “Corresponding author”。
  2. `source/**/*.{tex,ltx}`：`\author`、`\thanks{...}`、`\email{...}`、`\corresponding` 等宏常含邮箱。
  3. `{paper}/PAPER.md`、`{paper}/NOTES.md`：已有标题 / DOI / arXiv id 可直接喂给下面的 API。
- 不要删除或改写 `marks/`、`source/`、`assets/`、`attachments/` 及二进制文件。

## 需要产出的字段

- **一作（first author）**：姓名 + email + homepage + GitHub + ORCID + OpenReview 主页。
- **通讯作者（corresponding author）**：同上字段。
  - 论文未标注通讯作者时写「文中未标注」，不要拿一作顶替。
  - 一作与通讯为同一人时合并说明。
- **OpenReview 论文链接**：该论文 `https://openreview.net/forum?id=...` 页面（无则写「未找到」）。

## 各字段检索手段（含 URL / API）

> 约定：`{TITLE}` = 论文标题，`{NAME}` = 作者姓名，`{DOI}`、`{ARXIV}` 为对应标识。
> 调 API 时优先带上标题 / DOI 精确匹配，命中后再核对作者列表一致，避免同名误配。
>
> **工具选择**：本地无爬虫时用 Agent 的联网工具（WebFetch / WebSearch）而非裸 curl；
> 有反爬（Cloudflare challenge / 302）的站点（OpenReview、Papers with Code）尤其如此。
>
> **基线管线（推荐）**：先用 **OpenAlex**（免费、无 key、最稳）把论文映射到作者：
> `title→authorships[].author{ id, orcid, ... }`，拿到 **作者 id + ORCID + 机构**；
> 再据机构去作者主页找 email，据 ORCID / GitHub 补链接。其它源作交叉验证或兜底。
>
> **可靠性备忘（实测）**：OpenAlex / DBLP / ORCID / GitHub API 稳定可直调；
> Semantic Scholar 无 key 易 `429`（降为副源）；Crossref 的 `query.bibliographic`
> 是**模糊匹配**（可能返回别的论文），必须核对标题或改用 DOI 直引；
> Papers with Code API 已失效（302 跳转），不要依赖；OpenReview API 常被
> challenge 拦截（403），改走 Web 检索（见下）。

### 1. Email（最优先取论文原文）

1. **论文原文**：PDF 作者块 / 脚注、TeX 的 `\thanks{}` / `\email{}` —— 最可信，直接采用。
2. **作者机构主页**：进入下面查到的 homepage，页面常公开 `name@inst.edu`。
3. **交叉验证**：与机构域名一致（如作者在 MIT 则邮箱多为 `@mit.edu`）才写入。

Crossref / OpenAlex / Semantic Scholar 一般**不**公开邮箱，别指望 API 直接给 email。

### 2. Homepage / 个人主页

- **OpenAlex**（免费无 key，最稳的作者定位）：
  - 找论文作者：`https://api.openalex.org/works?filter=title.search:{TITLE}`（或 `doi:{DOI}`），
    取 `authorships[].author.id`。
  - 作者详情：`https://api.openalex.org/authors/{AUTHOR_ID}`
    （稳定给 `orcid`、`last_known_institutions`；`homepage_url` **多为空**，别指望它给主页）。
  - 拿到机构后，去机构 / 实验室站点找作者个人页（个人页常直接列 email）。
- **Semantic Scholar Graph API**（**副源**：无 key 易 `429`，命中再用）：
  - 论文：`https://api.semanticscholar.org/graph/v1/paper/search?query={TITLE}&fields=title,authors,externalIds`。
  - 作者：`https://api.semanticscholar.org/graph/v1/author/{AUTHOR_ID}?fields=name,url,homepage,affiliations,externalIds`。
- **ORCID**（拿到 orcid 可交叉验证身份，取法见下方 ORCID 小节）。
- **DBLP**（学者主页常在 `url` 字段）：
  - `https://dblp.org/search/author/api?q={NAME}&format=json`。
- **Google Scholar profile**：搜索 `{NAME} {机构/方向}`，取 `https://scholar.google.com/citations?user=...`。

优先机构 `.edu` / 实验室域名或 Google Scholar profile；聚合站（ResearchGate 等）作次选。

### 3. GitHub（及 github.io 主页）

1. **论文自带**：arXiv abs 页的 “Code” / 论文脚注 / homepage 上显式给出的仓库或账号，最可靠。
2. **GitHub Search API**（稳定，无 token 也可低频调用）：
   - 找仓库：`https://api.github.com/search/repositories?q={TITLE}` 或方法名关键词（常能命中官方实现）。
   - 找账号：`https://api.github.com/search/users?q={NAME}`（同名多，需下面第 5 步核实）。
3. **从作者其它开源论文反查（低优先）**：若已知该作者别的论文有开源实现，
   顺着那些仓库的 owner / 贡献者定位到同一 GitHub 账号（适合主页未列账号的情况）。
4. **Papers with Code**：其 API 已失效（302 跳转），不要调用；若要用只作人工参考。
5. **确认归属**：账号 bio / 仓库 README / commit 邮箱要能对上作者身份（机构、共同作者、方向），否则不写。
6. **顺带找 github.io 主页**：确认账号 `{login}` 后，个人主页优先按可靠性判定：
   - 强信号：仓库 `{login}.github.io` 存在（`https://api.github.com/repos/{login}/{login}.github.io`
     返回 200）→ 主页多为 `https://{login}.github.io`。
   - 弱信号：GitHub 用户 API `https://api.github.com/users/{login}` 的 `blog` 字段
     （**可能是 Twitter/其它**，非必为主页，需核对后再采用）。

### 4. ORCID

- 从上面 OpenAlex（`ids.orcid`）、Crossref（作者 `ORCID` 字段）、Semantic Scholar
  （`externalIds.ORCID`）任一命中即可取到 16 位 ORCID。
- 网页档案：`https://orcid.org/{ORCID}`；公开 JSON：`https://pub.orcid.org/v3.0/{ORCID}/person`
  （`Accept: application/json`，含姓名、机构、外链，有时含公开邮箱）。

### 5. OpenReview（论文页 + 作者主页）

> 实测：OpenReview 的 REST API（v1/v2 的 `notes` / `notes/search` / `forum`）常返回
> `403 Challenge required` 或 `searchUnavailable`，裸客户端基本调不通。**优先走 Web 检索**。

- **论文页（推荐 Web 检索）**：
  - 用 WebSearch 搜 `{TITLE} openreview` 或 `site:openreview.net {TITLE}`，
    命中 `https://openreview.net/forum?id={FORUM_ID}` 后核对标题 / 作者一致。
  - 亦可 WebFetch `https://openreview.net/search?query={TITLE}` 读取结果页。
  - API 兜底（仅在能过 challenge 的会话下）：`https://api2.openreview.net/notes/search?term={TITLE}`
    或 `https://api2.openreview.net/notes?content.title={TITLE}`（旧会场用 `api.openreview.net`）。
  - 仅在 arXiv、未投 OpenReview 会场的论文可能没有 —— 写「未找到」，不要硬编 id。
- **作者主页（profile）**：OpenReview 作者 id 形如 `~First_Last1`，主页为
  `https://openreview.net/profile?id=~First_Last1`。从论文 forum 页的作者链接取该 id 最直接；
  同样可用 WebSearch `{NAME} openreview profile` 命中后核对身份。

若无联网能力：只输出本地 PDF / TeX 能确认的条目，并明确标注「未联网核实」。

## 输出

两处产物：`{paper}/NOTES.md` 写**精炼结论**（frontmatter + 表格）；
`{paper}/attachments/author-report.md` 写**作者信息搜集报告**（人物档案）。
保留用户已有内容与既有 frontmatter，只做**合并**，不覆盖用户手写字段。

### 1) frontmatter（合并，供 Properties 面板识别）

缺失才补；已存在且非本次引入的键不改。只写**已核实**的值，查不到的键直接省略：

```yaml
openreview: https://openreview.net/forum?id=XXXX
first_author_homepage: https://example.edu/~alice
first_author_orcid: https://orcid.org/0000-0002-1825-0097
corresponding_email: alice@example.edu
```

URL 用裸标量，便于 Properties 面板识别为链接。

### 2) 正文小节：`## 联系方式与链接`

email 用 `mailto:` 链接便于点击发信；每行**必须**写「来源」：

```markdown
## 联系方式与链接

| 角色 | 姓名 | Email | 主页 | GitHub | ORCID | OpenReview | 来源 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 一作 | Alice Ng | [alice@example.edu](mailto:alice@example.edu) | [homepage](https://example.edu/~alice) | [@alice](https://github.com/alice) | [ORCID](https://orcid.org/0000-0002-1825-0097) | [profile](https://openreview.net/profile?id=~Alice_Ng1) | PDF p.1 脚注 |
| 通讯 | Bob Li | [bob@example.edu](mailto:bob@example.edu) | [bobli.github.io](https://bobli.github.io) | [@bobli](https://github.com/bobli) | — | — | OpenAlex + GitHub |

- OpenReview 论文页: <https://openreview.net/forum?id=XXXX>
```

- 来源示例：`PDF p.1 脚注`、`\thanks`、`OpenAlex`、`Crossref`、`DBLP`、`ORCID`、
  `GitHub Search`、`github.io`、`OpenReview`、`机构主页`、`Google Scholar`。
- 查不到的单元格填 `—`；整个角色都查不到时保留姓名行，来源写「未找到」。

### 3) 作者信息报告：`{paper}/attachments/author-report.md`

在附件里为一作与通讯作者各写一份**信息搜集报告**（人物档案），聚焦作者本身的公开信息，
而不是记录你的检索 / 取舍过程。NOTES 只留结论表，展开的作者背景放这里。

- 遵循 vault 约定：**有内容才创建** `attachments/`，不要预建空目录；支撑材料只放这里，
  不塞论文根目录或 `source/`。
- 每位作者一节，建议涵盖（有则写，无则略，不臆造）：
  - **基本信息**：姓名、当前职位 / 所属机构、所在地区、在本文中的角色（一作 / 通讯 / 共同）。
  - **研究方向**：主要研究主题、代表性成果 / 高引论文（可含年份、会议）。
  - **链接与联系**：email、个人主页、Google Scholar、GitHub、ORCID、OpenReview profile、
    （如公开）社交媒体；均附可点击链接。
  - **简介**：一段话概述其学术背景与近期工作（基于主页 / Scholar / 机构页等公开资料）。
- **一作作者的 Publication 全量表（必做）**：为本文一作列出其发表过的**全部** publication，
  用表格呈现，**本人为一作 / 共同一作的排在前面**，其余按发表年份倒序。
  - **首选 DBLP 去歧义作者页**（对同名最可靠）：先按姓名 + **机构**匹配到正确的作者
    （DBLP 用数字后缀区分，如 `Yujia Zheng 0001`，并带 affiliation 备注），
    经 `https://dblp.org/search/author/api?q={NAME}&format=json` 拿到 pid，再取
    `https://dblp.org/pid/{PID}.xml` 的全部条目。
  - **去重**：DBLP 常把会议正式版与 CoRR/arXiv 预印本各列一条，**同标题合并**，保留正式发表处。
  - **判定一作**：作者列表首位是否为该作者。
  - Google Scholar profile（作者自维护，最贴合本人）可交叉补全 DBLP 未收录项。
  - ⚠️ **不要用 OpenAlex `filter=author.id:` 直接拉列表**：对常见中文名，OpenAlex 的作者
    聚类会把**多个同名的人**（甚至跨领域论文）混进同一 id（实测一个「Yujia Zheng」id 混入
    光学 / 生物医学等无关论文）。若非用不可，须按机构 / 合作者 / 领域过滤并逐条核对。
  - 建议列：`一作? | 年份 | 标题 | 发表处(会议/期刊) | 链接(DOI/arXiv)`；
    `一作?` 用 `✓` / 空标记。条目很多时注明「据 DBLP，截至 {date}」。
  - 标题 / 会议 / 链接保持原文，不臆造缺失的年份或出处。
- 每条信息标注来源（如 `机构主页`、`Google Scholar`、`GitHub`、`PDF p.1`）。
- 抓取的网页快照等大文件也放 `attachments/`；不要写进 NOTES 或论文根目录。
- 若用户已在 `attachments/` 放了同名文件，改用带后缀的新名（如 `author-report-2.md`），不覆盖。

## 规则

- **不臆造**：邮箱 / 主页 / GitHub / OpenReview 必须基于可核实来源；不确定就留空并注明。
- 同名歧义：主页 / GitHub 需与论文作者身份对得上（机构、方向、共同作者）才写入。
- 保留用户已写的 wikilink 与正文；只新增或更新本小节与上述 frontmatter 键。
- 正文默认中文（表头、来源说明）；姓名、邮箱、URL 保持原文。
- 只写 `{paper}/NOTES.md` 与 `{paper}/attachments/`；不改 catalog、不改 `source/`、不改其它论文。
- 结束时用 `## Sources` 列出本次实际读取的 Vault 相对路径与联网来源 URL。
