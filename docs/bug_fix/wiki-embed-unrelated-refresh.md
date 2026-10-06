# 普通文本编辑触发全部 Wiki 嵌入闪烁

**状态**：已修复（全局索引 revision 与目标级嵌入刷新解耦）  
**影响面**：Markdown 编辑器中的 `![[...]]` Markdown、图片与 PDF 只读嵌入  
**相关代码**：

- `src/App.tsx` — 收集 watcher 批次路径，索引重建后通知实际变化的目标
- `src/lib/wiki-embed-refresh.ts` — 按规范化绝对路径管理嵌入订阅
- `src/lib/wiki-nav-context.tsx` — 不再向所有双链节点广播全局索引 revision
- `src/components/editor/wiki-embed-node.tsx` — 每个嵌入持有目标级 revision 与有界投影缓存
- `src/components/editor/wiki-attachment-embed.tsx` — 图片/PDF 字节缓存与稳定 viewer key
- `src/components/editor/embedded-markdown-projection.tsx` — memo 化只读 Markdown 投影
- `test/wiki-embed-refresh.test.ts` — 目标路径隔离、规范化与退订测试

---

## 1. 问题现象

一篇笔记已经渲染多个 `![[...]]` 嵌入后，即使用户只编辑与双链无关的普通文字，也会在自动保存后看到全部嵌入闪烁：

1. 普通文本写入当前 Markdown；
2. 约 900ms 后 Wiki 索引重建；
3. 所有 Markdown 投影重新出现 loading，图片重新创建 URL，PDF viewer 重新初始化；
4. 同一页面的嵌入越多，闪烁和卡顿越明显。

被嵌入的目标文件没有变化，因此这些重新加载没有业务意义。

---

## 2. 根因

旧实现用一个全局 `wikiIndexRevision` 同时承担两种不同职责：

| 职责 | 正确作用域 |
|---|---|
| 通知 Backlinks / Graph 重新查询全局关系索引 | 整个 Vault |
| 通知某个 `![[target]]` 重新读取内容 | 该 target 的依赖者 |

普通文本自动保存会经过：

```text
autosave 当前笔记
  → vault:file-changed
  → scheduleWikiRebuild
  → graph_rebuild
  → wikiIndexRevision + 1
  → WikiNavContext value 变化
  → 所有 WikiEmbedElement 收到新 revision
  → 所有 request key / projection key / attachment key 变化
  → 全部嵌入进入重新加载
```

虽然嵌入节点已经保持稳定挂载，Markdown 投影也可以 memo 化，但 revision 被放进请求 key 后，React 只能把它视为一份新资源。组件稳定并不能抵消错误的全局缓存失效。

---

## 3. 修复方案

### 3.1 分离两类 revision

- `wikiIndexRevision` 继续只服务 Backlinks 与 Graph，保证全局关系查询在 watcher rebuild 后保持新鲜。
- `WikiNavContext` 不再携带该 revision，普通双链和嵌入不会因为全局索引版本变化而一起重渲染。
- 每个 `WikiEmbedElement` 只维护自己的 `targetRevision`。

### 3.2 按目标路径订阅

嵌入完成 Host 解析后，以规范目标的绝对路径订阅：

```text
![[Target#Heading]]
  → Host resolver
  → targetPath
  → absoluteTarget
  → subscribeWikiEmbedTarget(absoluteTarget)
```

`scheduleWikiRebuild` 在约 900ms 的 debounce 窗口内收集 watcher 实际触及的路径。重建结束后，`notifyWikiEmbedTargets(changedPaths)` 只通知路径相同的订阅者。

路径 key 统一：

- `\` 转成 `/`
- 去掉末尾 `/`
- 使用大小写无关比较
- 同一批重复路径只通知一次

### 3.3 保持投影和附件稳定

| 层 | 稳定策略 |
|---|---|
| Wikilink / embed 节点 | stable non-void inline；selection 只切换源码与投影的可见性 |
| Markdown 投影 | `memo`；props 未变时不重新建立只读 Plate editor |
| Host 投影请求 | resolved request 使用有界缓存，并合并同 key 的并发请求 |
| 图片 / PDF | 缓存本地字节；只在对应 `targetRevision` 变化时更新 URL 或 viewer key |
| 编辑器 tab | autosave 只同步 seed，不增加 `seedKey`；外部内容重载才 remount |

---

## 4. 修复后的刷新语义

| 操作 | Backlinks / Graph | 当前嵌入 | 其它目标的嵌入 |
|---|---|---|---|
| 编辑普通文本并自动保存 | 重建后刷新 | 目标未变则保持 | 保持 |
| 修改被嵌入的 Markdown | 重建后刷新 | 重新读取对应全文/heading/block | 保持 |
| 替换被嵌入的图片或 PDF | 重建后刷新 | 重新读取对应附件 | 保持 |
| 一个目标被多处嵌入 | 重建后刷新 | 该目标的所有依赖投影刷新 | 其它目标保持 |
| 当前文件嵌入自身内容 | 重建后刷新 | 当前文件是目标，因此刷新 | 其它目标保持 |

这条边界保证索引正确性与编辑流畅度同时成立：关系索引仍可全量重建，内容投影不再全局失效。

---

## 5. 验收与回归

### 5.1 手动验收

1. 在同一笔记放置两个以上、指向不同目标的 Markdown/图片/PDF 嵌入。
2. 在普通段落连续输入，等待 autosave 和约 900ms Wiki rebuild。
3. 所有未改变目标的嵌入应保持稳定，不出现 loading、图片闪白或 PDF viewer 重置。
4. 修改其中一个被嵌入目标；返回来源笔记后，只有该目标对应的嵌入更新。
5. 同一目标存在多个嵌入时，确认这些依赖者均更新。

### 5.2 自动化证据

```bash
pnpm exec vitest run \
  test/wiki-embed-refresh.test.ts \
  test/wiki-completion.test.ts \
  test/wiki-attachment-embed.test.ts \
  test/wiki-navigation.test.ts \
  test/wiki.test.ts
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

目标测试共 55 项通过；路径隔离测试明确验证修改 A 不会通知 B。

---

## 6. 边界

- 修改真实目标时，相关嵌入会有意重新加载；这属于内容一致性要求。
- Backlinks / Graph 当前仍按约 900ms 防抖全量 rebuild；本修复没有实现边级增量索引。
- 远程 Vault 没有本地 watcher 时，目标刷新依赖远端文件事件能力。
- 嵌入递归最多 4 层，循环引用显示有界状态，不继续挂载重复投影。
- 未支持的 Canvas、音频/视频、远程 URL 与插件自定义 embed 不进入附件渲染路径。

---

## 7. 决议记录

| 议题 | 决议 |
|---|---|
| 全局索引 rebuild 是否保留 | 保留；Backlinks / Graph 仍以正确性优先 |
| 嵌入是否消费全局 revision | 否；只消费规范目标路径的局部 revision |
| selection 进入时是否卸载预览 | 否；仅切换可见性，保持投影组件挂载 |
| 是否轮询所有嵌入目标 | 否；复用 watcher 批次并按路径主动通知 |
| 缓存是否无界 | 否；Markdown 投影状态 128 项，附件字节 32 项 |
