# PDF 切换时视觉批注截图失败与后台 ONNX 生命周期

| 字段 | 内容 |
|---|---|
| 创建日期 | 2026-08-08 |
| 状态 | 已修复 |
| 相关 Issue | [#230](https://github.com/poco-ai/Agentero/issues/230)、[#231](https://github.com/poco-ai/Agentero/issues/231)、[#252](https://github.com/poco-ai/Agentero/issues/252) |
| 影响面 | PDF 视觉批注截图、Figures 缩略图裁剪、PDF 版面分析后台任务 |
| 相关代码 | `src/components/viewer/pdf/pdf-viewer.tsx`、`src/components/viewer/pdf/region-crop.ts`、`src/lib/pdf/layout/enqueue-paper-layout.ts`、`src/lib/pdf/layout/headless-analyze.ts`、`src/lib/pdf/layout/run-analysis.ts` |

---

## 1. 现象

### #230：切换 PDF 后视觉批注截图失败

复现路径：

1. 打开第一个 PDF。
2. 使用视觉批注框选区域，截图 / 裁剪可用。
3. 切换到另一个 PDF 显示后，再触发视觉批注截图。
4. UI 弹出：

```text
无法截取所选 PDF 区域。
Task rejected: {"code":14,"message":"document does not open"}
```

这不是 PDF 文件本身损坏，也不是 ONNX 模型失败。错误来自 EmbedPDF/PDFium 渲染任务：前端把一个已经关闭或正在关闭的 PDF document 传给了 `renderPageRect`。

### #231：后台 ONNX 是否依赖 active 论文窗口

#231 的标题是「ONNX 后台解析问题，是否需要论文窗口 active」。它和 #230 不是同一个直接 bug，但都落在同一类边界上：**PDF document 的生命周期是否绑定当前可见/激活窗口**。

结论：

- 已入库论文的后台 ONNX 任务不应该依赖 active PDF viewer。
- 它现在走 headless EmbedPDF 栈独立打开本地 PDF。
- active viewer 只负责把 `source/layout.json` 载入运行时 store，或处理无 paper 目录的散落 PDF。

---

## 2. 当前 PDF 打开与渲染链路

### 2.1 Workspace 如何挂载 PDF

`DocView` 根据 tab mode 渲染 PDF：

```text
DocView(tab.mode === "pdf")
  → PdfViewer(source / sourceBytes / docId)
  → EmbedPDF plugins
  → DocumentContent(documentId=docId)
  → PdfViewerInner
```

关键约束：

- `docId` 是每个 PDF tab 的稳定 EmbedPDF document id。
- Dockview 可能保留多个 panel shell。
- App 侧有 PDF LRU：active PDF 和近期/可见 PDF 保持 mounted；较旧 inactive PDF 会 unmount 以释放 PDFium document。
- NOTES 处于 active 时，右侧 Annotations/Figures 仍会 fallback 到 sibling PDF handle，因此 PDF handle 不能简单按 `isActive` 注销。

### 2.2 普通页面渲染

PDF viewer 注册的主要 EmbedPDF 插件：

| 插件 | 作用 |
|---|---|
| `DocumentManagerPluginPackage` | 打开、关闭、查询当前 document |
| `RenderPluginPackage` / `TilingPluginPackage` | 页面基础渲染与 tile 渲染 |
| `Viewport` / `Scroll` / `Zoom` | 视口、滚动、缩放 |
| `Selection` / `Annotation` | 划词、高亮、PDF link annotation |
| `AiManager` / `LayoutAnalysis` | 浏览器内 ONNX 版面分析 |

首选 `sourceBytes` 打开本地 PDF buffer，避免 WebView 对 `blob:` fetch 的不稳定；没有本地 bytes 时才使用 URL。

### 2.3 视觉批注截图

视觉批注不复用屏幕 canvas 截图，而是用 PDFium 重新渲染选区：

```text
用户框选归一化区域
  → beginVisualAnnotation(page, region)
  → docCap.getDocument(docId)
  → renderPdfRegionPromptImage(...)
  → engine.renderPageRect(document, page, rect)
  → PNG base64
  → VisualAnnotationEditor / Agent visual draft
```

好处是截图清晰、与当前缩放无关；代价是它强依赖 `document` 仍处于 DocumentManager 的 open 状态。

---

## 3. 后台 ONNX 任务链路

### 3.1 入队时机

已知 paper folder 的论文在以下场景会调用 `enqueuePaperLayoutAnalysis`：

- 魔棒 / 本地 PDF 入库完成后。
- 打开 paper PDF 时。
- PDF tab mount 后。

队列会先检查 `{paper}/source/layout.json`，已有 sidecar 则直接跳过。未命中才进入后台任务列表。

### 3.2 为什么不要求 active window

后台任务走 `analyzePaperLayoutHeadless`，它会自己建立一套独立 EmbedPDF plugin registry：

```text
enqueuePaperLayoutAnalysis
  → analyzePaperLayoutHeadless(paperAbsPath)
  → findLocalPdfPath(paperAbsPath)
  → localFileToArrayBuffer(pdfPath)
  → getHeadlessPdfEngine()
  → new PluginRegistry(engine)
  → register DocumentManager / Render / AiManager / LayoutAnalysis
  → openDocumentBuffer({ documentId: "headless-layout-..." })
  → runDocumentLayoutAnalysis(scope, documentId)
  → write source/layout.json + source/layout-index.json
  → closeDocument(documentId)
  → registry.destroy()
```

也就是说，后台 ONNX 用的是自己的 `documentId` 和自己的 DocumentManager 插件实例。它不需要用户当前正在看的 PDF tab，也不应该读取 visible/active viewer 的 document。

### 3.3 并发模型

后台任务用 `enqueueBackgroundTask(..., { concurrency: 1 })`，保证 ONNX 版面分析串行执行：

- 多篇论文可以都进任务列表。
- 实际 PP-DocLayoutV3 推理一次只跑一个。
- 这样避免浏览器/WASM/ONNX runtime 抢 GPU/CPU 和内存。

### 3.4 active viewer 的职责

active PDF viewer 不负责后台 ONNX 主流程。它做两件事：

1. 有 `source/layout.json` 时，静默把 sidecar 重新 merge 成 `layoutAnalysisStore`，供 Figures 侧栏和 hover hit-test 使用。
2. 对没有 paper folder 的散落 PDF，才允许 active tab 直接用 viewer 内 LayoutAnalysis 跑一次，因为这类 PDF 没有 `{paper}/source/layout.json` 的落盘位置。

---

## 4. 根因分析

### 4.1 直接根因

#230 的直接根因是视觉裁剪任务存在 document 生命周期竞态：

```text
const document = docCap.getDocument(docId)
await engine.renderPageRect(document, page, rect).toPromise()
```

在 `getDocument` 和 `renderPageRect` 完成之间，用户可能切换 PDF，Dockview/App LRU 可能让旧 PDF unmount，DocumentManager 随之关闭旧 document。此时 `document` 引用在 TypeScript 层仍是对象，但底层 PDFium document 已不再 open。

于是 EmbedPDF task reject：

```text
{"code":14,"message":"document does not open"}
```

原代码把这个 reject 当成普通截图失败展示给用户，所以切换 PDF 时会看到错误 toast。

### 4.2 为什么第一个 PDF 正常、切换后失败

第一个 PDF 中，视觉批注发生在同一个 mounted viewer / open document 生命周期内：

```text
选择区域 → 获取 document → 渲染裁剪图
```

切换 PDF 时，多了 unmount / closeDocument / active tab 变化：

```text
选择区域或 hover dwell 已排队
  → 用户切换 PDF
  → 旧 viewer inactive 或 unmount
  → 旧 DocumentManager closeDocument
  → 迟到的裁剪任务继续 renderPageRect
  → document does not open
```

hover dwell 场景尤其容易触发：用户悬停在 layout region 上，600ms 后自动打开视觉批注卡；如果这段时间内切换了 PDF，迟到任务仍可能运行。

### 4.3 为什么不能靠注销 inactive handle 解决

右侧面板依赖 PDF handle fallback：

- active tab 可能是 NOTES。
- Annotations / Figures 需要操作 sibling PDF。
- `resolveActivePdfHandle` 和 `annotationAction` 会按 paper body tab id 找 PDF handle。

如果 PDF tab 一 inactive 就注销 handle，会破坏「NOTES 聚焦但右栏仍能跳转 PDF / 渲染 Figures 缩略图」的工作流。

因此修复点不能是粗暴注销 handle，而应该是：**handle 可以存在，但每个需要 PDFium document 的操作必须在调用时确认 document 仍 open。**

### 4.4 #231 和 #230 的共同点

两者共享的设计问题是「不要把业务任务隐式绑定到当前 active viewer 的 document」：

- #230：视觉截图是 viewer 交互任务，必须防止使用已经关闭的 viewer document。
- #231：后台 ONNX 是 paper 级派生数据任务，必须使用 headless document，不依赖 active viewer。

所以它们不是同一条调用栈，但属于同一类生命周期边界。

---

## 5. 修复方案

### 5.1 视觉裁剪前检查 document open 状态

在 `beginVisualAnnotation` 中，裁剪前先用 DocumentManager 的公开 API 检查：

```ts
if (!docCap.isDocumentOpen(docId)) return;
const document = docCap.getDocument(docId);
```

这样切换 PDF 后迟到的视觉批注任务会直接 no-op，不弹错误。

### 5.2 裁剪完成后再次检查

即使裁剪前 document 是 open，`renderPageRect(...).toPromise()` 是异步任务，期间 document 仍可能关闭。因此裁剪完成后再次检查：

```ts
const image = await renderPdfRegionPromptImage(...);
if (!docCap.isDocumentOpen(docId)) return;
```

这避免把旧 PDF 的裁剪图挂到新 UI 状态里。

### 5.3 吞掉已知 close-race 错误

新增 `isPdfDocumentCloseRaceError(error)`，识别 EmbedPDF 返回的：

```text
document does not open
```

如果错误发生时 document 已关闭，或错误文本符合该 close-race 模式，就静默返回。其它真正的截图失败仍保留 `notifyError(t("pdfExplain.cropFailed"))`。

### 5.4 Figures 缩略图渲染同样加保护

`PdfViewerHandle.renderRegion` 供 Figures 侧栏渲染缩略图，也会走 `renderPdfRegionPromptImage`。修复后它同样：

1. 渲染前检查 `docs.isDocumentOpen(docId)`。
2. 获取 document 后再渲染。
3. 渲染完成后再次检查。
4. 任一失败返回 `null`，不污染侧栏缩略图状态。

### 5.5 文档同步

`docs/frontend/pdf-layout-analysis.md` 已明确写入：

```text
后台 ONNX 不依赖当前 active 论文窗口：headless EmbedPDF 独立打开本地 PDF
```

这把 #231 的设计边界写进功能文档，避免后续把后台分析错误地改回依赖 viewer document。

---

## 6. 修复后的行为

| 场景 | 修复后行为 |
|---|---|
| 在当前 PDF 正常框选视觉批注 | 正常裁剪并打开批注编辑器 |
| 框选 / hover dwell 后立刻切换 PDF | 迟到裁剪任务静默取消，不弹 `document does not open` |
| 右侧 Figures 需要缩略图但 PDF document 已关闭 | `renderRegion` 返回 `null`，等待 viewer 重新可用 |
| 已入库论文后台 ONNX | 继续走 headless 队列，不要求 PDF tab active |
| 散落 PDF 无 paper folder | 仍只允许 active viewer 跑内存分析 |

---

## 7. 验证

已执行：

```bash
pnpm typecheck
pnpm exec biome check src/components/viewer/embed/pdf-viewer.tsx
git diff --check
pnpm build
```

结果：

- TypeScript 通过。
- 修改过的 `pdf-viewer.tsx` Biome 检查通过。
- diff whitespace 检查通过。
- production build 通过。

注意：全量 `pnpm lint:ts` 当前仍会报仓库既有 lint warnings（例如 `feature-window` / `ui-store` import cycle、若干旧测试里的 non-null assertion），与本次改动无关。

---

## 8. 回归建议

手工回归优先覆盖：

1. 打开 PDF A，视觉批注框选，确认裁剪图正常。
2. 打开 PDF B，来回切换 A/B 后立即视觉批注，确认不再出现 `document does not open`。
3. 在有 layout sidecar 的论文打开 Figures 侧栏，确认缩略图可正常渲染；快速切换 PDF 时缩略图失败不应弹全局错误。
4. 导入一篇有本地 PDF 的论文，确认后台任务列表出现「解析插图、表格、文字」，且不要求该论文窗口保持 active。
5. 关闭 / 切换 active tab 后再打开该论文，确认 Figures 能从 `source/layout.json` 静默恢复。

---

## 9. 后续可选加固

- 为 `renderPdfRegionPromptImage` 增加可选 `isStillValid` 回调，把「异步渲染前后检查」封装到裁剪 helper 内。
- 在 visual hover dwell 定时器里监听 `docId` / `isActive` 变化，切换 PDF 时主动 bump sequence，减少迟到任务数量。
- 给 layout thumbnail 加一个轻量重试策略：`renderRegion` 返回 `null` 时，viewer ready 后再补一次。
- 增加 Playwright/Tauri E2E：打开两个 fixture PDF，快速切换并触发视觉批注，断言无 `document does not open` toast。
