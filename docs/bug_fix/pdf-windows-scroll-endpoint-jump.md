# Windows PDF 翻页时随机跳到首尾页（#539）

**状态**：已修复（取消过期的延迟跳转，并关闭虚拟页容器的浏览器滚动锚定）
**影响面**：Windows / WebView2 PDF 阅读器快速翻页与滚动

## 问题

EmbedPDF 的页跳转请求同步发出，但宿主 DOM 视口在下一帧才执行 `scrollTo`。用户在这一个时序窗口内开始滚动时，旧请求仍会落地，覆盖用户当前位置。与此同时，虚拟滚动器会换入/换出页面节点，Chromium 的 scroll anchoring 可能基于变化中的节点高度重新校正位置；在 Windows WebView2 中，这种校正可能落到文档首端或末端。

## 修复

- `createPdfViewportScrollScheduler` 将同一帧的 DOM 跳转请求合并为最新请求。
- 用户滚轮事件在原生滚动发生前取消尚未执行的请求；虚拟页重排、缩放布局和双栏同步产生的程序化 `scroll` 事件只更新指标，不会误取消合法请求。
- PDF viewport 设置 `overflow-anchor: none`，让自定义虚拟滚动器独占位置管理。

回归测试：`test/pdf-viewport-scroll.test.ts` 覆盖“延迟跳转后先发生用户滚动”与同帧请求合并。
