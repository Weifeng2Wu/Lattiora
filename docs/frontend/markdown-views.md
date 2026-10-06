# Markdown 编辑与渲染

普通 `.md`、`.mdx`、`.markdown` 与论文 `NOTES.md` 共用 Plate Markdown 编辑器、自动保存和外部修改保护。顶部三个图标提供：

- 编辑：沿用原 NOTES 的实时富文本编辑，标题、列表、数学公式与代码等即时显示。
- 编辑与渲染：左侧 Markdown 源码、右侧同一编辑器的只读渲染；窄屏上下排列。源码保留原文本、空行与 frontmatter，复用同一保存队列，不创建第二个写入者。
- 仅渲染：隐藏编辑工具，保留内容选择和文档阅读；返回编辑继续使用当前文档。

视图按当前浏览器和文件记忆，切换不丢未保存输入。源码未完成时不清理引用图片，避免打字过程中暂时缺失的图片语法触发资产删除。外部同步或 Agent 写入继续由原版本检查决定是否接收，不绕过冲突保护。

「新建文件」在未输入后缀时默认补 `.md`，与是否允许修改后缀无关；明确输入的 `.txt`、`.tex` 等保留其类型。只有「新建文件夹」创建目录。恢复标签页通过文件记录判断文件/目录，不再根据文件名有没有点号猜测。既有文件不会被批量改名；若以前保存成 `.txt` 或其他类型，需要通过允许修改后缀的重命名操作改成 `.md` 才按 Markdown 打开。

快速打开中的文件/内容命中直接打开实际文件；搜索 `NOTES.md` 时定位并展开该笔记，论文标题命中仍打开论文阅读布局。

实现：`src/components/editor/markdown-editor.tsx`、`hooks/use-markdown-persistence.ts`、`src/lib/vault/actions.ts`、`src/lib/workspace/tabs/resources.ts`。浏览器验证：`test/browser/markdown-capture.spec.ts`。
