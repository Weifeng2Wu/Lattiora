---
name: commit
description: >-
  Split current workspace changes into focused local Conventional Commits while
  preserving unrelated user changes. Use when preparing local commits.
---

# Local Commits

把当前工作区的改动按逻辑拆分为多个本地 Git commit，并保持每个 commit 可理解、可审查、可回滚。

## 执行规则

1. 先读取 `git status`、未暂存 diff、已暂存 diff 和最近提交历史。保留用户已有改动，不使用 `git reset --hard`、`git checkout --` 或其他破坏性操作。
2. 按独立目的分组改动，例如功能代码、测试、文档、版本 bump、CI；不要仅按文件夹机械分组。
3. 每组提交前检查相关文档：修改 UI、数据契约、发布流程或 Vault 语义时，把对应文档放入同一逻辑变更或单独的文档 commit。
4. 每个 commit 只包含一个目的，使用符合 Conventional Commits 的标题，例如 `feat: ...`、`fix: ...`、`docs: ...`、`chore(release): bump version to ...`。
5. 使用明确的文件路径或交互式 patch 精确暂存，避免把无关改动带入 commit；不要依赖 `git add .` 盲目提交。
6. 每组提交前运行与该组风险匹配的最小验证；版本 bump 至少检查所有版本字段和 `Cargo.lock`，代码改动至少运行对应类型检查、测试或 lint。
7. 提交后检查 `git log` 和 `git status`，确认 commit 顺序、标题、内容归属和剩余未提交改动都正确。
8. 默认只创建本地 commit，不 amend、rebase、创建 tag、push 或发布 Release；这些操作必须由用户明确要求。

## 异常处理

- 如果改动无法合理拆分，先说明分组方案再提交。
- 如果存在冲突、敏感文件、生成物或无法解释的改动，停止提交相关部分并报告路径与原因。
- 不为无关的已有改动补写说明、不重写用户提交历史。
