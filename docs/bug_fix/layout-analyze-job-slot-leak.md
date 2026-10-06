# 版面解析任务一直排队（JobCenter 槽位泄漏）

**状态**：已修复

## 问题

打开多篇论文或连续触发版面解析时，左下角任务条里只有第一篇会跑，后面的一直停在「排队」。点取消：进行中的条目有时弹回来，排队的取消后新任务依然排队。重启应用后队列恢复，说明不是磁盘 sidecar，而是进程内调度状态坏了。

## 根因

`layoutAnalyze` 本地 ONNX 的并发上限是 1（Paddle API 不设上限）。前端 executor 跑完后通过 `job_report(state: succeeded|failed|cancelled)` 上报终态；Rust runner 用 `wait_for_terminal` 看到终态再调 `finish()`。

`job_report` 以前只改 `job.state`，**不释放** `running_by_kind`。`finish()` 见到已经是终态就直接返回，避免覆盖用户取消，也因此**不会补释放槽位**。第一篇一结束，计数永远停在 1，后续全部 `Waiting`。

取消看起来「没取消掉」有两层叠加：

1. 槽位已经漏掉，排队任务取消了也开不了下一档。
2. 终态之后迟到的 `job:changed(running)`（进行中的进度事件）会把已取消/已完成的任务条复活；取消钩子是 `AbortSignal` 的 `{ once: true }`，第二次点击只改 UI，不再调 `job_cancel`。

`job_cancel` 本身会释放槽位，但要等 runner 的 500ms 轮询醒来才 `drain`。runner 若已不在，队列也不会往前走。

## 修复

- `job_report` 收到终态时释放 `running_by_kind` 和 `active_keys`，与 `cancel` / `finish` 一致；随后 `finish()` 仍是 no-op，不会双减。
- `job_cancel` 与终态 `job_report` 立刻 `drain_and_spawn`，不等 runner 醒来。
- 任务条投影忽略已结束任务的迟到 `queued`/`running` 事件。
- 面板取消改为可重复调用的 `job_cancel` handler，不再依赖一次性 abort 监听。
- 启动投影时 `job_list` 回填已有 queued/running，避免 listener 接上之前的事件丢失。

测试：`layout_analyze_job_report_terminal_frees_concurrency_slot`、`test/job-center-projection.test.ts`。
