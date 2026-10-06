# 任务 runner panic 导致并发槽永久泄漏（JobCenter panic 安全）

**状态**：已修复

## 问题

潜在缺陷（架构审查发现，与 layout-analyze-job-slot-leak.md 同族但根因不同）：

1. job runner 内任何 panic（TeX 解析、sidecar IO 等）都会让 `finish()` 永不执行，该 kind 的并发槽 `running_by_kind`（如 layoutAnalyze cap=1）与去重键 `active_keys` 永久泄漏，后续同类任务全部卡「排队」；重新入队还会被去重逻辑返回幽灵快照。
2. 取消状态存于全局 `CANCELLED: Mutex<HashSet<String>>`，条目仅靠 `finish()` 清除。任务崩溃后条目泄漏，且**污染复用同一 task id 的下一个任务**（新任务一出生就处于「已取消」状态）。

## 根因

`spawn_runner` 丢弃 JoinHandle，`run_started` 先 `await work` 再 `finish()`；槽位释放只发生在 `finish`/`job_report`/`cancel` 三处，panic 跳过全部三处。取消标志按 task_id 全局登记、无生命周期归属。

## 修复

- `run_started` 重构为 supervisor：runner 移入子任务并 await JoinHandle，JoinError（panic）→ `settle_crashed_runner` → `finish(Failed)` 释放槽位/去重键、发 `job:changed`、`wake_and_spawn_dependents` 推进队列。`finish` 对已终态 job 幂等，不覆盖 Cancelled、不双减槽位。
- 每个 job 在 `mark_running_locked` 创建独立 `CancellationToken`（tokio-util）；`cancel` 触发并移除自身 token，`finish`/`job_report` 终态路径移除条目——不泄漏、复用 id 不受污染。
- RAII `CancelTokenBridge` 在 runner 生命周期内把 token 桥接到深层 `is_cancelled(task_id)` 轮询点（pdf_parse 引擎、下载器等），Drop 覆盖 panic / future 被弃等所有路径；非 JobCenter 使用者（citing scan、model_assets、import/agent 命令）保留原 HashSet 语义，完全兼容。

测试：`crashed_runner_settles_failed_and_frees_slot_and_key`、`cancel_running_job_signals_token_and_cleans_up_on_exit`、`reused_task_id_is_not_poisoned_by_cancelled_or_crashed_job`。
