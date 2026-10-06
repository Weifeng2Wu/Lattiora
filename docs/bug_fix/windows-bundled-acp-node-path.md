# Windows 内置 ACP 适配器在初始化前退出

## 现象与根因

Agentero 0.11.3 Windows 安装版的 Codex ACP 探测与历史列表读取失败，日志显示
`initialize: Incoming transport closed`。

Tauri 的资源目录来自 canonicalize 后的可执行文件路径，Windows 下带有 `\\?\`
前缀。`registry/bundled.rs` 保留该前缀构建 `entry_js`，原来的
`acp/client.rs::plan_local_launch_with` 又将其直接作为 `node <entry.js>` 的参数。
本机 Node 22.22.1 在解析此入口脚本时即报
`EISDIR: illegal operation on a directory, lstat 'C:'`，退出码为 1，尚未进入 ACP 握手。

## 修复

在内置适配器启动参数的构造处复用 `windows_shell_path(&adapter.entry_js)`，
去除本地 Windows 盘符路径的扩展前缀。路径仍作为一个独立参数传入，不增加 shell
包装或手工引号。Codex 与 Claude 的内置适配器共用此修复。

PATH 安装的适配器、用户配置的 host 环境变量和原有参数顺序不变；
辅助函数保留 UNC/device 路径的原有语义，不做无条件前缀截断。

## 验证

- 本机安装的 `codex-acp 1.12.0` + Node 22.22.1：同一入口带 `\\?\` 前缀时
  退出码为 1、无 initialize 响应；去除前缀后 ACP initialize 返回协议版本 1。
- Rust 回归用例 `plan_local_launch_normalizes_bundled_windows_entry` 覆盖 Codex/Claude
  两种模板、含空格的入口路径、Node 路径和附加参数的保留。
- 从实际源码提取路径转换函数与入口参数构造语句进行独立 Rust 编译验证：修改前
  路径断言失败，修改后断言通过，且成功执行本机适配器的 `--version`。
- 本机 Cargo 1.73 无法解析仓库的 v4 lockfile，完整 Rust 回归测试需在新版工具链运行：
  `cargo test -p agentero --lib plan_local_launch --locked`。
