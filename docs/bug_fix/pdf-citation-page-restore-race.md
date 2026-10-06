# PDF 引用 `#page=` 跳转后被拉回第 1 页

**状态**：已修复（pending 页意图优先于 reading-position restore + 短时重试跳转）  
**影响面**：从 Markdown / Agent / Wiki 打开 `papers/.../*.pdf#page=N`（及 section/figure/region 片段）时的首次落地页  
**相关代码**：

- `src/lib/pdf/pending-pdf-page.ts` — 一次性待跳页意图
- `src/components/viewer/pdf/hooks/use-pdf-navigation.ts` — 恢复阅读位置时优先消费 pending
- `src/lib/workspace/actions.ts` — `scheduleCitationJump` 写入 pending 并短时重试

---

## 1. 问题现象

点击 `papers/vla/2504.16054/2504.16054.pdf#page=11` 后，PDF 会短暂滚到第 11 页，随即又显示第 1 页（或上次保存的阅读位置）。

## 2. 根因

`openCitation` → `resolvePdfCitation` → `scheduleCitationJump` 在 PDF handle 一注册就 `scrollToLayoutRegion`。与此同时 `usePdfNavigation` 在 `scrollReady` + `totalPages` 就绪时恢复 localStorage 里的上次阅读页；EmbedPDF 完成布局时也可能把视口重置到首页。

时序常见为：

1. 引用跳转先滚到第 11 页（handle 已在，文档布局未稳）。
2. 布局完成或 restore effect 把视口拉回第 1 页 / 已保存页。
3. `scheduleCitationJump` 是一次性完成，不会再跳。

`#427` 的 `currentPage > 1` 守卫挡的是「用户已手动翻页后的迟到 restore」，挡不住「程序化跳转尚未稳定就被 restore / 初始化覆盖」。

## 3. 修复方案

1. 解析出 citation target 后写入内存 pending 页（abs + vault-relative 别名，对齐 viewer 的 `paperKey`）。
2. 首次 restore：**有 pending 则滚到该页并消费**，否则才读 saved reading position。
3. `scheduleCitationJump` 在 0 / 300 / 800ms 重试跳转，约 2s 后停止；pending 再多留 2s 给迟到的 restore。

## 4. 验收

1. 关闭该 PDF 面板后，从 NOTES 点击 `#page=11` 链接。
2. 应稳定停在第 11 页，不应先闪后回到第 1 页。
3. 无 fragment 普通打开 PDF 仍应恢复上次阅读位置。

```bash
pnpm exec vitest run test/pdf-pending-page.test.ts
```
