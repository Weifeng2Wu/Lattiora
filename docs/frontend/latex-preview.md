# LaTeX 轻量实时预览

打开 `.tex` 文件后，点击源码编辑器右上角的「LaTeX 实时预览」图标。预览读取当前编辑缓冲区，输入停止约 200 ms 后更新，不等待自动保存。宽面板左右排列，宽度不足 640 px 时上下排列；再次点击图标收起，编辑器、选区和撤销历史保持不变。

支持正文段落、中英文、标题/作者与 `\maketitle`、章节、粗体/斜体/等宽/下划线、列表、引用与居中环境、verbatim，以及 `$…$`、`$$…$$`、`\(…\)`、`\[…\]`、equation/align/alignat/gather 数学环境。公式复用已有 KaTeX 与缓存，没有新增依赖或编译服务。

作者 `\thanks` 显示上标和标题下方的附注，正文 `\footnote` 汇集到文末；附注里的格式和公式继续渲染。`\date` / `\today` 显示日期。`thebibliography` / `\bibitem` / `\newblock` 渲染为带编号的参考文献列表，支持自定义条目标识和多个 cite key。

`\cite` 显示条目编号（如 `[1]`），`\ref` 显示章节或公式编号，`\eqref` 显示带括号的公式编号（如 `(1)`）。支持前向引用，编辑后从当前文本重新计算；未知 key 保留可见。章节采用 article 风格的 section/subsection/subsubsection 层级；非星号 equation 以及 align/alignat/gather 的顶层每行自动编号，尊重星号环境、`\notag` / `\nonumber` 和显式 `\tag`。嵌套矩阵的换行不会多计编号。

这是单文件内容预览，不是完整 LaTeX 编译器：不执行宏包、自定义宏、`\input`/`\include`、图片/表格排版或 BibTeX，不实现宏包定义的计数器、自定义文档类编号或 natbib 作者年份样式。未知正文命令/环境和未完成输入保留为可见源码。最终分页、宏包排版、BibTeX 生成与投稿 PDF 仍需导出源文件后使用正式 LaTeX 编译器。

预览按需加载；应用显示 Offline ready 后可离线首次打开、编辑和重载。源码仍走既有 IndexedDB/outbox/版本冲突流程；预览只读，不生成或上传 PDF。作者文本转义，KaTeX 使用 `trust: false`，不读取引用路径或请求外部资源。超过 500,000 字符的文件暂停预览并提示；单个超过 20,000 字符的公式退回源码，源码编辑不受影响。

实现：`src/components/viewer/latex-preview.tsx`、`src/lib/tex/preview.ts`。验证：`test/tex-preview.test.ts`、`test/browser/tex-preview.spec.ts`；浏览器场景使用生产构建与隔离 Wrangler。

基础论文语法补齐验证：16 项解析测试通过；生产构建（含 TypeScript）和变更文件 Biome 检查通过。隔离 Wrangler + Chromium 场景通过（46.2 秒），核对内置 thesis 的作者附注、参考文献、引用编号及离线更新/保存。首次浏览器检查受到共享构建目录更新干扰，改用独立静态产物副本后复验通过；没有把超时轮次算作通过。
