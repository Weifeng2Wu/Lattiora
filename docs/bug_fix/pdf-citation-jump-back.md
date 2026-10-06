# PDF 内部链接跳转后返回原位置

**Issue**：[#505](https://github.com/poco-ai/Agentero/issues/505)

**影响面**：PDF 阅读视图中的正文内部链接（Appendix / 图表 / 公式 / 引用交叉引用）

## 问题

点击正文里的内部链接（如 "see Appendix A"）后，`usePdfCitations` 的
`handleCitationLinkActivate` 通过 annotation 插件的 `navigateTarget` 平滑滚动到目标位置，
之后没有任何返回机制。Appendix 通常在文档末尾，读者只能手动翻回原页，无法判断
原来读到哪里。

## 修复

- 新增 `lib/pdf/jump-back-stack`：纯逻辑的原点栈（LIFO、深度上限 20、对栈顶同页
  近距离原点去重），可独立单测。
- 新增 `hooks/use-pdf-jump-back`：围绕 viewport / scroll capability 的
  capture → commit → pop 状态机。
  - `captureJumpOrigin` 在 `navigateTarget` 发起前读取视口像素偏移与当前页码；
  - `commitJumpOrigin` 仅在 `navigateTarget` 结果为 `navigated` 时入栈——URI
    外链与 unsupported 目标不会污染栈；
  - `goBack` 出栈并 `scrollTo({ x, y, behavior: "instant" })` 原样恢复（`navigateTarget`
    只滚动不改 zoom，像素偏移在往返期间始终有效）。
- `usePdfCitations` 增加 `onBeforeInternalJump` / `onInternalJump` 回调对，与
  现有 `onPreviewShow` 同样的 ref 镜像风格，不改变 handler 身份。
- 新增 `chrome/pdf-jump-back-chip`：左上角工具栏正下方的浮动小 chip（与底部栏
  同用 `PDF_CHROME_CHIP` 材质，双层结构：材质层不响应 hover，反馈是按钮上的
  accent 叠加 + `active:scale` 按下反馈，遵循 apple-design），显示“返回跳转前”，
  点击恢复。渲染在侧面板之前的 DOM 上，面板展开时自然让位。
- 跳转落点注意力反馈：`getLinkDestination` 补充返回目标锚点的 x 坐标
  （XYZ `params.x` / FitR `view[0]`，仅有纵向锚点时为 null）；跳转成功后由
  `flashJumpTarget` 把目标行构造成归一化窄条（锚点 x → 右边距，一行高），交给
  现有 `setFocusedLayoutRegion(..., { flash: true })` 琥珀闪烁（保持 ~0.9s 后
  1.6s 内淡出），读者一眼看到落点。区域型跳转（图/表 cross-ref 走
  `scrollToLayoutRegion`）本就有区域高亮，两类落点都有视觉锚。
- 行为设计：**滚动不清除 chip**——跳到 Appendix 后长时间阅读、翻页，返回入口仍在；
  连续跳转形成栈，可逐级返回（浏览器式）；文档切换（docId 变化）清空。
- i18n：`viewer:pdf.jumpBack`（en "Jump back" / zh “返回跳转前”）。

## 验证点

- 点击正文 "Appendix A" 等内部链接后，落点行出现琥珀色高亮闪烁并淡出，
  同时左上角工具栏下方出现“返回跳转前”chip。
- 在 Appendix 中滚动阅读多页后点击 chip，视口回到跳转前的精确位置（含页内偏移）。
- 多次连续跳转可逐级返回；URI 外链不产生 chip 与闪烁；切换文档后 chip 消失。
- 双栏翻译视图由 `usePdfScrollSync` 自动跟随返回滚动，无需额外处理。

Roadmap 与 TODO 已检查：这是已实现内部链接跳转能力的体验缺陷修复，不新增未完成产品项。
