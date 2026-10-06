# PDF 旋转页显示为未旋转页框

**影响面**：PDF 阅读器与翻译分屏中带 `/Rotate 90` / `/Rotate 270` 的页面。

## 现象

某些论文 PDF 的页面字典带有旋转元数据。示例：
`papers/10_3389_fpls_2025_1611992/10_3389_fpls_2025_1611992.pdf`
共 10 页，其中第 4、5 页为 `/Rotate 90`。系统 `pdfinfo -f 1 -l 10 -box`
能正确读出这两页旋转，但应用内这两页占据竖向 A4 页框，横向表格横躺、
与页框错位。

修复上述三轮后，第 4、5 页又出现"两页重叠"：底图已是横版正立，但其上
叠了一层侧躺的竖版内容，溢出横版页框压到下一页。

## 原因

四轮缺陷叠加：

1. **原始缺陷**：`renderPage` 把未旋转的 `PageLayout.width` / `height` 传给
   内层 `PdfPageLayers`，内层页框竖版而外层滚动槽横版，纸张边框与内容错位。
2. **错误前提的补丁**（6d074dfd）：当时判断"Document Manager 的
   `normalizeRotation: true` 会让 PDFium 返回已含 `/Rotate` 的显示尺寸与已
   转正的光栅"，据此给 plugin-scroll / plugin-selection / plugin-tiling 打
   补丁，从有效旋转中剥除 `page.rotation`。实测引擎语义恰好相反
   （`test/pdf-page-rotation.test.ts` 固化）：

   - `page.size` 是**未旋转内容空间**（MediaBox）的尺寸，竖版 595×842；
   - `page.rotation` 保留 `/Rotate` 元数据（90 → 1）；
   - 光栅只有在 `rotation = page.rotation` 时才渲染为正立的横版。

   剥除 `page.rotation` 后，滚动槽、瓦片、划词菜单全部少了这 90°，页面
   竖版、表格横躺。
3. **同一前提的残留**（00f368d6）：`page-layers.tsx` 的
   `pdfPageRenderRotation` 以 `document.normalizedRotation ? 0 : page.rotation`
   抹零——应用恒为 normalized 模式，底图光栅永远按 rotation=0 渲染
   （竖版 + 横躺内容），再塞进恢复上游公式后的横版页框。
4. **tiling 插件两层缺 rotation**（上游 `@embedpdf/plugin-tiling` 2.14.4 /
   2.15.1 均有）：
   - `renderTile` 调用引擎时不传 `rotation` → 瓦片位图按 rotation=0 光栅，
     `/Rotate 90` 页的瓦片内容侧躺；
   - `TileImg` 直接把瓦片的 `screenRect`（在**未旋转**内容空间按
     `page.size * scale` 切分）当 CSS left/top/width/height 摆放 → 竖版几何
     （如 850×1024）叠在横版页框（1024×850）上，溢出压到下一页，视觉即
     "两页重叠"。

   引擎层（direct-engine 的 `renderRectEncoded` 与 worker 路径）本就完整
   支持 `options.rotation`（奇数旋转宽高互换 + 变换矩阵渲染），故修复收敛
   在 plugin-tiling 一个包内。

## 修复

- 删除 `@embedpdf/plugin-scroll`、`@embedpdf/plugin-selection` 补丁，
  恢复上游 `effectiveRotation = ((page.rotation ?? 0) + coreDoc.rotation) % 4`；
  tiling 补丁回到仅含 `dpr` 类型声明与瓦片占位（瓦片坐标本就用上游公式）。
- `renderPage` 内层 `PdfPageLayers` 使用 `rotatedWidth` / `rotatedHeight`
  （含 `/Rotate` 与手动旋转的显示尺寸）。
- `pdfPageRenderRotation` 无条件取 `page.rotation`，与滚动槽、瓦片同一
  有效旋转。
- 扩展 `@embedpdf/plugin-tiling` patch 补齐第 4 轮缺陷：
  - tile id 加入 `rotation`，旋转变化时瓦片集整体换血；
  - `renderTile` 计算有效旋转并经 `options.rotation` 传给引擎；
  - React 侧 `TileImg` 在 `rotation !== 0` 时用 `@embedpdf/models` 的
    `transformRect(unrotatedContainerSize, screenRect, rotation)` 先把
    未旋转空间的摆放矩形变换到旋转后容器（90° 顺时针为
    `(x,y,w,h) → (H−y−h, x, h, w)`），再作为 CSS 摆放。
- `test/pdf-page-rotation.test.ts` 固化引擎两种模式的旋转契约，防止再次
  反向"修复"。

## 验证

```bash
pdfinfo -f 1 -l 10 -box /Users/philfan/l/test/papers/10_3389_fpls_2025_1611992/10_3389_fpls_2025_1611992.pdf
pnpm exec vitest run test/pdf-page-rotation.test.ts
pnpm typecheck
pnpm exec biome check src/components/viewer/pdf/pdf-viewer.tsx src/components/viewer/pdf/pdf-translation-viewer-inner.tsx
```

应用内打开该论文，第 4、5 页应为横版页框 + 正立表格。

第 4 轮修复的验证另用独立端口 harness（同仓库 `vite --port 1430` +
`pdf-dev.html` 加载该 PDF 第 4 页）：长驻 dev 进程会按旧 patch hash 路径
缓存已加载的 tiling 模块，`ignoreCache` reload 无效，必须换端口或重启。
DOM 层确认瓦片位图变为横版（2048×1702 等）且无元素溢出页框；截图视觉
确认表格正立、无两页重叠。**更新 patch 后需重启 `tauri dev` 才能在应用内
看到效果。**

上游对照：npm 2.15.1 的 plugin-tiling 与 2.14.4 逐字节相同，`npm pack`
对比确认未修；升级 EmbedPDF 版本时需检查该 patch 是否可 retiring。
