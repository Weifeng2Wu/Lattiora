# 组织目录被识别成单篇论文（#201）

**状态**：已修复
**影响面**：`papers/` 文件树、论文路径归属、Agent 论文上下文与 PDF/NOTES 关联

## 问题

`papers/` 下的目录原先只要直接包含 `NOTES.md`、`PAPER.md`、`metadata.json`
或 `source/` / `assets/` / `marks/`，就会被标记为论文目录。论文目录在文件树中是叶节点，
因此不会继续展示子目录。

当一个组织目录同时保存索引笔记时会误判，例如：

```text
papers/rubric/
├── NOTES.md                 # 组织级文献索引
├── 2601.04171/
│   ├── NOTES.md
│   └── metadata.json
└── 2601.15808/
    ├── NOTES.md
    └── metadata.json
```

`papers/rubric` 会先被当成论文，子论文不会进入 `paperFolders`。随后
`paperDirFromPath` 还可能把子论文文件归属到 `papers/rubric`。

## 根因

论文识别把“目录自身存在 marker”和“目录是最小论文单元”混为一谈。
`NOTES.md` 既可以是论文笔记，也可以是组织目录的索引笔记；文件名本身无法区分这两种语义。

## 修复

- 保留 `NOTES.md` 对历史 NOTES-only 论文目录的兼容。
- 若目录子树中包含论文后代，嵌套论文优先，当前目录保留为组织目录。
- 跳过论文内部的 `source/`、`assets/`、`marks/`、`attachments/`，避免它们的任意资源被误认为嵌套论文。
- 当 `paperFolders` 已经是非空列表时，文件路径归属以该列表为准；不再把未命中的组织级 `NOTES.md` 回退归属为论文。
- Host 的 marker 仍用于 `source/` 懒加载，但不把这个遍历优化语义当作前端论文身份的唯一来源。

## 验证

- 新增组织索引 `NOTES.md` + 多个嵌套论文的回归测试。
- 新增已知论文路径列表阻止组织级 `NOTES.md` 错误归属的测试。
- `test/paper-metadata.test.ts`
- `test/vault-tree.test.ts`
- `test/context-path-icon.test.ts`
- `test/agent-mention.test.ts`
- TypeScript typecheck
