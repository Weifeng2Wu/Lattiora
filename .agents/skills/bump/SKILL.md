---
name: bump
description: Upgrade the Cloudflare web application version.
---

# Version Bump

此分支只发布网页应用。选择合法 SemVer 目标版本，同步 package.json，检查 pnpm-lock.yaml 是否包含根版本，运行类型/构建检查。

- 保留无关改动，遵循根 AGENTS.md。
- Tauri、Rust、CLI 和 iOS 已移除，不重新引入不存在的版本来源。
- 模板变更或不兼容架构迁移需更新版本并同步文档。
- 按 commit skill 建立独立 Conventional Commit；未经用户要求不创建 tag、push 或 Release。
