# Windows 启动与「问题诊断」弹出黑色控制台窗口

**状态**：已修复（两处控制台子进程补 `CREATE_NO_WINDOW`；分支 `fix/windows-doctor-console-window`，提交 `83f75a0b` / `8fd0216d`）
**影响面**：Windows 发布版（GUI 子系统）两个独立场景 —— 启动时闪一次黑终端、打开「设置 → 问题诊断」时每探测一个工具弹一个黑窗
**相关代码**：

- `src-tauri/src/core/telemetry/device.rs` — `raw_device_model()`，新增 `device_model_command()`
- `src-tauri/src/core/telemetry/mod.rs` — `Telemetry::start` 无条件调用 `collect_device_info()`
- `src-tauri/src/features/agent/doctor.rs` — `diagnostic_command()` / `run_command()`
- `src-tauri/src/features/agent/commands/doctor.rs` — `doctor_check_host` / `doctor_check_agents`
- `src/components/settings/panes/doctor-pane.tsx` — 面板挂载即触发探测
- 对照实现（均已带该 flag）：`features/agent/registry/lifecycle.rs`、`features/agent/registry/version_check.rs`、`integration/mcp/tunnel.rs`
- 文档：[`../backend/doctor.md`](../backend/doctor.md)、[`../backend/telemetry.md`](../backend/telemetry.md)

---

## 1. 问题现象

### 1.1 启动时闪一次黑终端

直接运行 `agentero.exe`：启动过程中闪过一个黑终端（极快），随后进入应用。

### 1.2 打开「问题诊断」弹出两个黑窗

进入 设置 → 问题诊断，**无需点击**任何按钮，会弹出黑色终端窗口，且恰好是两个。窗口标题是
`hermes.exe` 的完整路径；因为 Hermes 冷启动慢，窗口会停留几十秒，不是一闪而过。

> 二次确认时的反直觉现象：用户反馈「官方发布的软件没有遇到过」，但实测官方 0.9.7 同样会弹
> （见 4.2 的 A/B 数据）。差异只在触发时机 —— 官方那次 `reg` 触发得更早，不易察觉。

## 2. 根因

### 2.1 共性：GUI 子系统 + 控制台子进程缺 `CREATE_NO_WINDOW`

发布版是 `windows_subsystem = "windows"` 的 GUI 进程（PE `Subsystem = 2`）。这类进程 spawn
**未带 `CREATE_NO_WINDOW`** 的控制台子进程时，Windows 会为子进程分配一个可见控制台 —— 就是看到的黑窗。

本项目其他同类位置（`registry/lifecycle.rs`、`registry/version_check.rs`、`integration/mcp/tunnel.rs`）
都已带该 flag，只有下面两处是遗漏。

### 2.2 启动路径：telemetry 无条件探测设备型号

`core/telemetry/device.rs` 的 `raw_device_model()`（Windows 分支）用

```
reg query HKLM\HARDWARE\DESCRIPTION\System\BIOS /v SystemProductName
```

取硬件型号（macOS 走 `sysctl`、Linux 读 sysfs，Windows 没有更便宜的等价物）。关键在调用时机：
`Telemetry::start` 里 `install_id()` / `collect_device_info()` 是**无条件**执行的，不受 PostHog
key 或用户 opt-out 影响，而 `Telemetry::start` 在 Tauri setup 后即被调用 —— 所以**每次启动必闪**。

### 2.3 诊断路径：面板挂载即探测，按注册条目逐个跑

`doctor-pane.tsx` 在 `useEffect` 里直接调 `doctorCheckHost()` + `doctorCheckAgents()`，不需要点击。
`doctor_check_agents` 对 `agents.json` 里**每一条** Agent 注册项跑一次 `<command> --version`。
本机注册了两条（`catalog-hermes` 用 `hermes`、自定义 profile 用完整 `hermes.exe` 路径），
于是出现两个标题相同的黑窗。

## 3. 修复

### 3.1 `doctor.rs`（83f75a0b）

`diagnostic_command` 拆成 `base_command` + `hide_console_window`，Windows 下统一收口
`creation_flags(CREATE_NO_WINDOW)`，让 cmd / PowerShell / 工具 exe 三条路由共用一处。
新增 Windows 回归测试钉住命令路由 —— `creation_flags` 在 std 里**没有 getter**，无法直接断言 flag，
所以测试断言的是 program + args。

### 3.2 `device.rs`（8fd0216d）

抽出 `device_model_command()`，同样加 `creation_flags(CREATE_NO_WINDOW)`；加 Windows 回归测试。
命令内容与解析逻辑完全不变，设备型号照常采集。

## 4. 验证

### 4.1 单测与静态检查

- `cargo check -p agentero --locked` ✅
- `cargo test -p agentero --lib features::agent::doctor` → 12 passed ✅
- `cargo test -p agentero --lib core::telemetry::device` → 1 passed ✅
- `cargo fmt --all -- --check` 干净；pre-commit（biome + cargo fmt）通过 ✅
- `pnpm tauri build --config .tauri-build-no-updater.json` 打包成功（NSIS + MSI），
  产物为 `PE32+ / x86_64 / Subsystem=2 (GUI)` ✅

### 4.2 运行时黑箱验证：`reg.exe` 垫片

5ms 轮询追踪在修复后的构建上**没抓到** `reg`（短命进程，见 4.3），所以改用确定性方法：

写一个 **console 子系统**的同名 `reg.exe` 垫片，实现里调用 `GetConsoleWindow()`：

- 返回 NULL ⇔ 父进程传了 `CREATE_NO_WINDOW`（无窗口）
- 返回非 NULL ⇔ 会弹黑窗

垫片必须放进**应用目录**（`target/release/` 或安装目录）：CreateProcess 的搜索顺序是
应用目录 → 当前目录 → System32 → PATH，所以 `PATH` 里的垫片拦不到 `reg`（System32 在 PATH 之前）。

同一个垫片分别喂给两个版本，唯一变量是构建：

| | `reg query` 是否仍被调用 | `GetConsoleWindow()` |
|---|---|---|
| 官方 0.9.7 | ✅ 是 | **1 —— 分配控制台窗口（会闪黑框）** |
| 本修复构建 | ✅ 是 | **0 —— 无控制台窗口** |

结论：`reg query` 功能完整保留（设备型号照常采集），可见控制台窗口消失。这比目视更可靠。

### 4.3 为什么 5ms 轮询不可靠

PowerShell runspace 里「5ms 轮询 `Get-Process` 记录新增 pid」看起来很直接，但每次 `Get-Process`
都是全量枚举，**实际间隔远大于 5ms**，`reg query` 这类只有几十毫秒的进程经常抓不到。
命中与否靠运气 —— 别据「没抓到」下结论（本 Bug 排查中先误判过一次）。

## 5. 可复用的排查手法

1. 先确认二进制子系统（PE header 的 `Subsystem` 字段，2=GUI）。GUI + 控制台子进程 = 黑窗前提。
2. 找可疑 spawn：`grep -n "Command::new" <rs files>`，再逐个查 `CREATE_NO_WINDOW` 覆盖情况。
3. 用 4.2 的垫片法做确定性验证（优于轮询追踪）。
4. 应用有 `tauri-plugin-single-instance`：追踪/垫片测试前必须关掉所有实例，否则新进程被转发后直接退出。
5. 本机环境自身每 ~5.5s 会有一波 `cmd` + `findstr` + `tasklist`（父进程恒定），属噪声，勿计入应用行为。
