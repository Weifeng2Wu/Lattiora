# AGENTS.md

## 项目概览

Lattiora（研织）是保留原 React 19 界面的单人、离线优先科研网页工作台。浏览器 IndexedDB 为即时工作副本，Cloudflare Workers + D1 + R2 提供登录、版本同步和统一 AI。论文 metadata 为每论文 `.paper.json`，笔记及源文件保持可导出的普通文件。Tauri/Rust/CLI 已移除。

架构总览：[docs/architecture.md](docs/architecture.md)

## 开发规则

- 优先做小而聚焦的改动，能用少的修改解决问题就不要增加复杂度。高内聚、低耦合。如果系统有额外冗余可以提示用户进行重构
- 只加必要的影响性能和功能的测试代码，不加没有实际意义的测试用例。
- 尽可能能复用能力，避免重复造轮子。
- 在 UI 修改的过程中尽量少加入无关的、非必须的i18n 文案，如果能用icon表达，就不要加额外的描述。操作失败用 `notifyError` Toast，不在侧栏 header 挂常驻错误条。
- 国际化（i18n）：所有面向用户文案必须经 `t()` 走 `react-i18next`。en 源语言 → 同步 `zh-CN`（`src/i18n/locales/`）。详见 [docs/frontend/shell.md](docs/frontend/shell.md)。
- 如果修改了 Template 下的 Skill 和 AGENTS.md ，需要对应更新版本号。
- 修改后需同步更新相关文档，并检查 Roadmap 和 Todo。
- 修改完成后，把当次相关的改动按照 commit 部分的要求提交。

## 网页约束

- 只支持 HTTPS（或 localhost）、IndexedDB、Web Locks、Service Worker 的浏览器。
- 不引入本机命令、原生 Tauri 依赖或客户端明文模型 Key。
- 文件操作复用 `src/lib/cloud`，保持 outbox、版本校验和冲突副本语义。
- 界面保持原 React 工作流；不可将无法迁移的功能伪装成成功。
- `docs/bug_fix/` 保留为历史复盘；当前部署以 `docs/deployment/` 为准。

## Commit

- 提交信息必须符合 [Conventional Commits](https://www.conventionalcommits.org/) 规范。
- 一次提交只做一件事，避免混合多个 unrelated changes。
- 如果有多个 unrelated changes，`git commit --only -m "msg" -- <path1> <path2>` 使用只提交指定路径的改动
- commit message 不可以有emoji
- 如果库当中有对应的 issue，则在提交信息中引用（如 `Fix #123`）；解决了该 issue 则关闭；部分解决则在 issue 区评论。
- 解决 Issue 之后，把解决的方法评论在 issue 中

## 常用命令

```bash
pnpm install
pnpm dev
pnpm db:migrate:local
pnpm dev:web
pnpm typecheck
pnpm typecheck:worker
pnpm test:cloud
pnpm test:browser
pnpm build
pnpm lint
```

提交前运行改动相关验证。UI 与离线行为用生产构建 + Wrangler 检查。部署授权与凭据使用遵循用户指示。

## 文档

- README 保持为稳定的产品入口，中英文结构同步；部署流水、修复过程、验证结果分别记录到对应文档，不在 README 逐次追加。

- 架构：`docs/architecture.md`
- 部署/备份/费用：`docs/deployment/cloudflare.md`
- 能力逐项清单：`docs/deployment/capabilities.md`
- 验证：`docs/test/cloudflare.md`
- Roadmap/Todo：`docs/development/web-migration.md`
- 原前端组件说明：`docs/frontend/`（桌面桥接章节为历史背景）
- 历史故障：`docs/bug_fix/`（保留）
