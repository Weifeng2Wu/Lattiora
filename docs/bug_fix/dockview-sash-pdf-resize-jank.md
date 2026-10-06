# 拖动 Dockview 分隔条时 PDF 卡顿（sash drag resize jank）

**状态**：已修复（per-frame pointermove 合并 + EmbedPDF resize 门控 + 临时 layout/paint containment）  
**影响面**：中间栏 PDF / NOTES 分屏（及任意带 PDF 或重型 panel 的 Dockview 拖动）  
**相关代码**：

- `src/lib/workspace/dockview-sash.ts` — `installDockviewSashFrameLoop`、`createLatestFrameDispatcher`、`isDockviewSashTarget`
- `src/components/workspace/dock-workspace.tsx` — 挂载 sash frame loop，挂载点 `.agentero-dockview`
- `src/lib/pdf/dockview-resize.ts` — `createPdfViewportResizeGate`（拖动期间暂停 EmbedPDF viewport metrics）
- `src/components/viewer/embed/pdf-viewer.tsx` — `DockviewViewport` 包装 EmbedPDF viewport，按拖动状态门控
- `src/index.css` — `.agentero-dock-sash-active` 期间的 `contain: layout paint` 与 `user-select: none`
- `test/dockview-sash-pointer.test.ts` — sash frame 调度与 pointerup 补齐测试
- `test/pdf-dockview-resize.test.ts` — resize gate 合并 / suppress / 一次性提交测试
- 文档：`docs/frontend/workspace.md`、`docs/frontend/shell.md`、`docs/test/release-checklist.md`

---

## 1. 问题现象

PDF 与 NOTES 左右分屏时，用鼠标 / 触控板拖动中间的 Dockview 分隔条（sash）会出现：

1. 分隔条与 panel 边界**跟不上指针**，松手后突然回跳到最终位置；
2. PDF 文本选区、高亮、批注针在拖动过程中**位置错乱或闪烁**；
3. 高刷屏（120Hz / 240Hz 触控板）上一帧内多次 pointermove 堆积，整帧掉帧明显；
4. 同一帧里其它 panel（编辑器、图片预览）也会跟着重排。

直接观感是「拖一下卡一下，松手才到位」。

---

## 2. 根因

拖动 sash 时，每一次原始 `pointermove` 都会同步触发**两条独立的昂贵链路**，且二者都没有节流：

```text
pointermove (原始, 一帧内可能 N 次)
 ├─ Dockview layoutViews()   ← 递归重排所有受影响 panel
 │    └─ 触发 panel 容器几何更新、tabs 条、render overlay
 └─ EmbedPDF viewport ResizeObserver
      └─ 提交 viewport metrics
           └─ 重算可见页 + React setState + 文本层 / 画布重绘
```

### 2.1 Dockview 7 的默认行为

Dockview 7 在每个原始 `pointermove` 中同步执行递归 `layoutViews()`。高刷输入设备在一帧内可以触发多次 `pointermove`，导致同一帧里几何被反复重算，相邻 panel 也被牵连失效。

### 2.2 EmbedPDF 的 ResizeObserver

`DockviewViewport`（pdf-viewer 内）原实现对 viewport DOM 的任何宽高变化都立刻提交 viewport metrics。一次 sash 拖动 = 几十次 metrics 提交 = 几十次可见页重算和 React 状态更新。**这才是 PDF 卡顿的主因**，而不是 Dockview 的几何更新本身。

### 2.3 缺少 containment

`dv-view` / `dv-render-overlay` 没有 layout/paint containment，一次重排会让同级 panel 一起进入 layout 阶段；拖动期间也缺少 `user-select: none`，浏览器原生文本选择会进一步打断指针流。

### 2.4 不应一起做的事

- **手动数值缩放（如 125%）**：拖动期间若让 EmbedPDF 重算 viewport，用户设的 zoom 会被覆盖；
- **布局持久化**：Dockview 的 `onDidLayoutChange` 已经只在松手后触发，这一层无需额外处理。

---

## 3. 修复方案

核心思路：**两条昂贵链路分别节流，且互不耦合**。

### 3.1 Dockview 一侧：每帧只转发最后一次坐标

`installDockviewSashFrameLoop` 挂在工作区 `.agentero-dockview` 根节点上，在捕获阶段拦截 pointerdown：

| 信号 | 处理 |
|---|---|
| pointerdown 命中 `.dv-sash` 且属于本工作区 | 进入「sash 拖动态」，加 `.agentero-dock-sash-active`，`preventDefault` 阻止原生选区 |
| 拖动中的 pointermove | **取消** Dockview 原生监听，改 enqueue 到 `createLatestFrameDispatcher` |
| `requestAnimationFrame` 触发 | 合成一条 pointermove 转发 Dockview，只携带本帧最后一次坐标 |
| pointerup / pointercancel / contextmenu / window blur | 在交给 Dockview 前**同步 flush** 最终坐标，避免松手回跳 |

效果：**一帧最多一次 Dockview layoutViews**，松手前不留尾巴。

### 3.2 EmbedPDF 一侧：拖动期间暂停 metrics

`DockviewViewport` 仍让 viewport DOM 边界随 Dockview 几何即时跟随（所以页面看起来在连续裁剪 / 展开），但 `createPdfViewportResizeGate` 做了门控：

| 阶段 | 行为 |
|---|---|
| 普通 ResizeObserver 触发 | 合并到单次 rAF，提交 metrics |
| `beginDockResize()` | 取消待处理 frame，进入 suppress |
| 拖动中每次 notifyResize | 不提交 metrics（viewport DOM 仍在跟随几何） |
| `endDockResize()` | 排一次 rAF，提交**最终**尺寸，然后恢复正常合并模式 |

进入 / 退出拖动态由 pdf-viewer 的 `pointerdown` 检测目标是否 `.dv-sash` 决定，并在 `pointerup` / `blur` / `contextmenu` 时收尾。手动 zoom 值原样保留，不被 PDF 重算覆盖。

### 3.3 跨 panel 隔离 + 选区抑制

`src/index.css` 在 `.agentero-dock-sash-active` 期间：

```css
.agentero-dockview.agentero-dock-sash-active .dv-view,
.agentero-dockview.agentero-dock-sash-active .dv-render-overlay {
  contain: layout paint;
}

.agentero-dockview.agentero-dock-sash-active {
  -webkit-user-select: none;
  user-select: none;
}
```

注意**不能用 `display: none` 或卸载 render overlay**——那会让 PDF 壳保活失效（见 `docs/frontend/workspace.md` 的 overlay 锚点说明）。

### 3.4 前后对比

| 维度 | 修改前 | 修改后 |
|---|---|---|
| Dockview pointermove | 每个原始事件同步 layoutViews | 每帧只 1 次，松手前补齐 |
| EmbedPDF viewport metrics | 每次 ResizeObserver 都提交 | 拖动期间 suppress，松手后单帧提交 |
| DOM viewport 视觉跟随 | 同上 | 仍逐帧跟随（不触发 PDF 重排） |
| 手动 zoom（如 125%） | 可能被覆盖 | 保留 |
| 跨 panel 失效 | 重排牵连同级 | 拖动期间 contain |
| 原生文本选择 | 干扰指针流 | 拖动期间禁用 |

---

## 4. 验收

### 4.1 手动验收（release-checklist 7.1.3a）

1. 打开一篇 PDF 并与 NOTES 分屏，把 PDF 设为手动 125%。
2. **慢速**向左 / 向右来回拖动中间 divider——分隔条与 PDF panel 边界应逐帧跟手，PDF 选区不抖、页面只被即时裁剪 / 扩展，125% 保持。
3. **快速**来回拖动——无输入堆积、无卡顿。
4. 在一次快速拖动中**直接松手**——panel 边界落到指针松手位置，无回跳，滚动区与最终尺寸一致。
5. 拖动期间不应误选 PDF 或相邻编辑器的文本。

### 4.2 自动化证据

```bash
pnpm exec vitest run \
  test/dockview-sash-pointer.test.ts \
  test/pdf-dockview-resize.test.ts
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

`sash-pointer.test.ts` 验证：一帧内多次 enqueue 只 dispatch 一次、pointerup 前补齐最终坐标、`pointerup` / `contextmenu` / `blur` 均能结束拖动态、非本工作区的 sash 不被劫持。  
`pdf-dockview-resize.test.ts` 验证：普通 resize 合并到一帧、`beginDockResize` 取消待处理 frame、拖动期间 suppress、`endDockResize` 后只提交一次、`dispose` 后再不调度。

---

## 5. 边界

- **松手到提交有一帧延迟**：这是用「PDF 不在拖动中重排」换回的代价；松手后视觉立刻对齐。
- **只门控 EmbedPDF 一侧**：其它重型 React panel（大段 Markdown 投影等）仍会随 Dockview 几何更新；containment 只是限制其重排范围，不会暂停它们。
- **`contain: layout paint` 仅在拖动期间启用**：松手立刻移除，不影响日常滚动 / 选区。
- **多窗口、多 Dockview 实例**：`isDockviewSashTarget` 只认本工作区 `contains` 的 sash，不会跨窗口劫持 pointerdown。
- **远程 Vault / 无触控板设备**：修复对低频 pointermove 无副作用——per-frame 合并在低刷屏上等价于「原样转发」。
- **不改动布局持久化**：`onDidLayoutChange` 仍是 Dockview 原生「松手后触发」，本次修复未触碰。

---

## 6. 决议记录

| 议题 | 决议 |
|---|---|
| 是否在拖动期间卸载 / 隐藏 PDF panel | 否；会破坏 PDF 壳保活，改为只暂停 viewport metrics 提交 |
| viewport DOM 是否跟随几何 | 是；保持视觉跟手，只把昂贵重排推迟到松手 |
| 节流放在 Dockview 还是 EmbedPDF | 两层都要；两条链路独立、互不耦合 |
| containment 用 `display: none` 还是 `contain` | 用 `contain: layout paint`；前者会破坏保活 |
| 手动 zoom 是否参与重算 | 否；EmbedPDF 重算只覆盖 viewport 尺寸，不改 zoom |
| 是否持久化拖动中的中间几何 | 否；沿用 Dockview 原生「松手后持久化」语义 |
