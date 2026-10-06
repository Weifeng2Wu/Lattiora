# Windows PDF 滚动时自动跳回已保存阅读位置（#427）

**状态**：已修复（恢复阅读位置前检查当前滚动页码）  
**影响面**：Windows 端 PDF 阅读器；在 EmbedPDF scroll capability 就绪较晚时防止阅读位置恢复覆盖用户当前滚动位置  
**相关代码**：

- `src/components/viewer/pdf/hooks/use-pdf-navigation.ts` — 阅读位置恢复守卫

**Issue**：[#427](https://github.com/poco-ai/Agentero/issues/427)

---

## 1. 问题现象

Windows 上打开 PDF 并向后滚动（翻到后面几页）时，视图会突然跳回之前保存的阅读位置（通常是靠前页面，视觉上像“回到第一页”）。

复现视频：用户从论文首页向后滚动到方法论章节后，视图瞬间跳回引言部分。

## 2. 根因

`usePdfNavigation` 的阅读位置恢复逻辑在 `totalPages > 0 && scrollReady` 时触发一次：

```ts
if (restoredRef.current || totalPages <= 0 || !scrollScope) return;
// …立刻 scrollToPage(saved)
```

`scrollReady` 只是 `Boolean(scroll)`，它变成 `true` 表示 EmbedPDF 的 scroll capability 已可用，但并不代表此时 DOM 视口仍处在初始顶部。在 Windows / WebView2 / 非整数 DPR（如 125%）环境下，scroll plugin 的 capability 就绪时机可能晚于用户实际滚动事件：

1. PDF 打开，用户开始向后滚动。
2. 视口已经滚到第 N 页，`currentPage` 已经更新。
3. 此时 `scrollReady` 才第一次变为 `true`，恢复 effect 触发。
4. effect 不知道用户已经滚动，直接 `scrollToPage(savedEarlierPage)`，把视图拽回早前保存的位置。

## 3. 修复方案

在恢复前读取 scroll scope 的当前 metrics，若 `currentPage > 1` 说明用户已经离开首页，跳过本次恢复并标记为已恢复：

```ts
const metrics = scrollScope.getMetrics();
if (metrics && metrics.currentPage > 1) {
  restoredRef.current = true;
  return;
}
```

这样既保留了正常打开 PDF 时恢复阅读位置的行为（此时 `currentPage === 1`），又避免了 readiness 延迟导致的“滚动中跳回”问题。

## 4. 边界

- **正常打开**：首页时 `currentPage === 1`，恢复逻辑照常执行。
- **已滚动后 reopen**：如果组件重新挂载且滚动状态重置，此守卫会失效；目前未观察到该场景，若出现需要结合 session 级恢复标记进一步处理。
- **水平滚动**：本应用使用垂直滚动策略；`currentPage > 1` 对水平布局同样适用。

## 5. 验收

1. Windows 125% 缩放下打开一篇多页 PDF。
2. 快速向后滚动到后续页面。
3. 视图不应自动跳回引言/首页。
4. 关闭 PDF 后重新打开，仍应恢复到上次离开的位置（正常恢复行为保留）。

```bash
pnpm exec vitest run
pnpm exec tsc --noEmit
```
