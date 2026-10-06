# 标题双链稳定性与 Metadata Cache 调研

| 字段 | 内容 |
|---|---|
| 创建日期 | 2026-07-25 |
| 类型 | 问题分析 / 架构演进 |
| 状态 | 已实现，等待真实 Vault E2E |
| 相关文档 | [双链、反链与图谱](../backend/wiki.md) |

## 1. 结论

Agentero 已按调研结论实现两个相互独立的能力：

1. 显式“重命名当前标题”命令：负责精确改写来源 Markdown 中的标题双链与嵌入，是关系正确性的实现。
2. 可持久化 Metadata Cache：负责加速索引恢复、反链、补全和图谱查询，是性能优化，不替代 Markdown 改写。

实现复用 Obsidian 的产品语义，没有照搬前端 IndexedDB 技术栈。Wiki 解析、查询和写入事务均由 Rust Host 管理，缓存由 Host 保存到应用缓存目录中的 SQLite。Markdown 继续作为唯一事实来源；缓存损坏、缺失、过期或版本不兼容时直接从 Vault 重建。

自动化已经覆盖显式事务的精确改写、门禁与回滚，以及 cache 的 warm/cold 等价、文件变化、损坏/版本失配、完整性篡改、删除重建和不可写降级。真实 Vault 中的交互、重启与删除 cache 后复验由 Owner E2E 完成。

## 2. 问题

已建立的引用可能包含标题 fragment：

```markdown
[[目标笔记#旧标题]]
![[目标笔记#旧标题]]
[显示文本](目标笔记.md#旧标题)
```

用户在目标笔记中把 `旧标题` 手工编辑为 `新标题` 后，来源文件仍保留旧 fragment。下一次 Wiki 索引重建能够解析目标文件，却无法在文件中找到旧标题，关系成为 `invalidFragment`：

```text
目标文件仍存在
  ├─ 文件级解析成功
  └─ #旧标题解析失败
```

点击此类链接仍可能打开目标文件，因此容易被误认为关系仍然有效；它不能保证滚动到改名后的标题。必须以是否精确定位到新标题为验收标准。

当前已实现的文件和目录改名事务只更新文件目标路径，并保留原有 heading/block fragment。它不能推断标题文本的变化。

## 3. Obsidian 机制

### 3.1 Markdown 与可重建缓存

Obsidian 将笔记保存在 Markdown 文件中，并把 Metadata Cache 持久化到 IndexedDB，以便应用重启后快速恢复。官方设置提供 “Rebuild vault cache”，说明缓存是可以从 Vault 文件重新生成的派生数据。

公开 API 显示：

| 结构 | 保存内容 | 稳定标题身份 |
|---|---|---|
| `MetadataCache.resolvedLinks` | 来源文件路径到目标文件路径及引用次数 | 无 |
| `LinkCache` | link text、原始文本、源码位置、显示文本 | 无 |
| `HeadingCache` | 标题文本、H1–H6 level、源码位置 | 无 |
| `BlockCache` | 显式 block ID 与源码位置 | 有，来自 Markdown 中的 `^block-id` |
| `resolveSubpath` | 用当前文件缓存解析 heading/block subpath | 匹配失败返回 `null` |

由此可知，Obsidian 没有公开的 heading UUID 或隐藏关系表来维持标题身份。IndexedDB 保留的是索引投影，不是第二份双链事实来源。

### 3.2 改名行为

| 用户操作 | Obsidian 行为 | 是否改写来源 Markdown |
|---|---|---|
| 手工编辑 Markdown 标题 | 旧标题 fragment 失效；文件部分仍可解析 | 否 |
| 执行 `Rename this heading…` | 搜索引用并更新可识别的标题 fragment | 是 |
| 重命名文件 | 由 “Automatically update internal links” 设置控制 | 是 |
| 修改 block 正文并保留 `^id` | block 引用保持稳定 | 否 |
| 修改或删除 `^id` | 旧 block 引用失效 | 需要显式改写 |

Obsidian 社区的受限模式复现表明，手工改标题不会更新来源链接，右键“重命名当前标题”才会更新。多级标题的官方重命名能力仍只有部分支持。可审查的 Keep Headings 插件同样只调用官方 `editor:rename-heading` 命令，没有维护私有关系数据库。

## 4. 已放弃的自动推断方案

曾尝试在每次 Agentero Markdown 自动保存时比较保存前后的 heading 序列，并在满足以下条件时推断一次标题改名：

- heading 数量不变；
- level 序列不变；
- 只有一个 heading 文本变化；
- 新 fragment 可以唯一解析。

该方案没有进入正式实现，原因如下：

- 普通文本保存承担了跨文件重构副作用，用户无法明确区分编辑与重命名操作。
- 增删、移动、拆分、合并、批量编辑和外部编辑无法可靠推断语义。
- 一个关联来源存在未保存修改时，目标笔记的普通自动保存可能被阻塞。
- 推断规则与 Obsidian 的显式重命名语义不同，后续兼容成本较高。
- Metadata Cache 持久化无法解决上述歧义；它只能保留旧索引快照。

因此，普通 autosave 不应自动猜测 heading rename。

## 5. 推荐设计

### 5.1 显式重命名当前标题

编辑器已在右键菜单提供“重命名当前标题…”。命令优先作用于光标所在标题；光标在正文时定位当前章节之前最近的标题，位于首个标题之前时定位首个标题。只要文档存在标题且 dirty、只读、remote/非本地等门禁未触发，命令即可显示受控的新标题输入框；无法从保存态唯一确认标题时禁用。

已实现的 Host 接口：

```text
wiki_rename_heading {
  vaultPath,
  path,
  headingPath,
  headingLine,
  expectedContent,
  newText,
  dirtyPaths
}
```

字段含义：

- `headingPath`、`headingLine` 与 `expectedContent` 共同确认被重命名的旧标题，不能仅凭显示文本定位。
- `newText` 是标题正文，不包含 Markdown `#` 前缀。
- `dirtyPaths` 用于阻止覆盖其它已打开但未保存的来源笔记。

控制流：

```text
用户执行“重命名当前标题”
  → Host 校验目标文件内容仍等于 expectedContent
  → 从旧 WikiIndex 确认目标 heading
  → 生成目标文件的新 Markdown
  → 查找所有已解析到该 heading 的入链 occurrence
  → 规划精确 fragmentRange 编辑
  → 复核来源内容、hash、dirty path 与编辑范围
  → 原子写入目标和来源 Markdown
  → 任一步失败则回滚已写文件
  → 重建或增量更新 WikiIndex 与持久化缓存
  → 通知受影响的打开标签页重新加载
```

改写范围必须包括：

- `[[目标#旧标题]]`
- `![[目标#旧标题]]`
- Vault-local Markdown link
- 同文件 `[[#旧标题]]`
- 父标题改名造成的完整多级标题路径

改写时保留文件目标、alias、embed 标记、Markdown label、周围空白和其它正文。歧义引用、无效 fragment、磁盘冲突和 dirty source 必须在写入前终止，不能退化为字符串全局替换。

### 5.2 Host 侧持久化 Metadata Cache

`WikiIndex` 仍是 Rust Host 中的内存查询结构；`graph_rebuild` 优先校验 warm snapshot，未命中时从 Vault 文件全量生成。持久化层位于：

```text
agentero_cache_dir()/wiki/<vault-key>.sqlite
```

缓存不写入 Vault，不参与同步，也不进入 `.agentero/catalog.sqlite`。`catalog.sqlite` 是论文 metadata 的权威存储，Wiki Cache 只能是可删除的派生数据。

当前 snapshot 保存：

```text
cache_metadata
  schema_version
  parser_version
  vault_key
  vault_path
  built_at
  snapshot_hash

files
  relative_path
  size
  modified_time_ns
  content_hash

documents
  path
  aliases
  headings
  blocks

occurrences
  ordinal
  resolved_link_json
```

加载规则：

1. 校验缓存 schema、parser 版本和 Vault 身份。
2. 比较文件集合及 size、mtime、content hash。
3. 完全一致时恢复内存 `WikiIndex`。
4. 存在任一差异时立即全量重建，再覆盖缓存。
5. 缓存损坏、缺表、版本变化或读取失败时删除对应快照并重建。
6. 缓存写入失败只记录日志，不能阻塞 Markdown 保存、导航或重命名事务。

显式标题重命名不能盲信持久化快照。事务开始前仍需验证目标和所有待写来源的当前磁盘内容。

### 5.3 两项能力的关系

```text
Markdown
  ├─ 唯一事实来源
  ├─ 显式重命名事务负责安全改写
  └─ 解析生成 WikiIndex
                    └─ 持久化 Cache 只负责快速恢复
```

删除整个 Cache 后，所有链接解析、重命名和图谱结果必须与删除前一致。

## 6. 实施状态

### Phase 1：显式标题重命名事务 ✅

- 在 Host 增加 heading 身份、精确 fragment range 和 `wiki_rename_heading`。
- 复用文件改名事务的 hash、dirty path、原子替换和回滚纪律。
- 覆盖 Wikilink、嵌入、Markdown link、同文件 fragment 和多级标题路径。

### Phase 2：编辑器入口 ✅

- 编辑器右键菜单增加“重命名当前标题…”，并按光标所在章节定位标题。
- 文档存在可映射到保存态的标题且 dirty、只读、remote 等门禁通过时启用。
- 成功后同步目标编辑器、受影响标签页、Backlinks、Graph 和嵌入投影。

### Phase 3：Metadata Cache 持久化 ✅

- 为 `WikiIndex` 增加版本化 SQLite snapshot。
- 打开 Vault 时加载并校验缓存。
- watcher、保存和改名完成后刷新缓存。
- 提供删除缓存后重建的内部诊断路径。

### Phase 4：回归与真实 Vault 验收

- [x] 自动化覆盖成功、歧义、dirty source、磁盘冲突、写入失败和回滚。
- [ ] Owner E2E：使用真实 Vault 验证普通双链、嵌入、同文件标题、多级标题和同名文件。
- [ ] Owner E2E：删除缓存、重启应用后重复验收，确认缓存不影响语义。

## 7. 验收标准

- 普通手工编辑 heading 不触发隐式跨文件改写。
- 显式重命名命令同步普通双链、嵌入和 Vault-local Markdown link。
- alias、文件目标、显示文本和无关正文保持字节级不变。
- 同名文件依靠 Vault 相对路径保持唯一目标。
- dirty source、磁盘冲突或歧义关系导致零写入。
- 多文件写入失败后恢复目标与全部已写来源。
- Cache 缺失、损坏或过期时自动重建，不影响正确性。
- 删除 Cache 后的 Backlinks、Outgoing links、Graph、补全和导航结果一致。
- 文件改名继续沿用现有 `wiki_move` 事务，不与 heading rename 混用。

## 8. 资料

- [Obsidian：How Obsidian stores data](https://help.obsidian.md/data-storage)
- [Obsidian：Internal links](https://help.obsidian.md/links)
- [Obsidian API：MetadataCache](https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache)
- [Obsidian API：CachedMetadata](https://docs.obsidian.md/Reference/TypeScript+API/CachedMetadata)
- [Obsidian API：LinkCache](https://docs.obsidian.md/Reference/TypeScript+API/LinkCache)
- [Obsidian API：HeadingCache](https://docs.obsidian.md/Reference/TypeScript+API/HeadingCache)
- [Obsidian API：BlockCache](https://docs.obsidian.md/Reference/TypeScript+API/BlockCache)
- [Obsidian API：resolveSubpath](https://docs.obsidian.md/Reference/TypeScript+API/resolveSubpath)
- [社区复现：Manually Renaming a Linked Heading Breaks the Link](https://forum.obsidian.md/t/manually-renaming-a-linked-heading-breaks-the-link/103801)
- [社区说明：Nested heading rename is partially implemented](https://forum.obsidian.md/t/links-to-nested-heading-not-updating-when-heading-is-renamed/101505)
- [Keep Headings 插件](https://github.com/playermiller109/obsidian-keep-headings)