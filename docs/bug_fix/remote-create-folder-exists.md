# 远程 Vault：无法新建文件夹 / 文件

**Issue**：[#152](https://github.com/poco-ai/Agentero/issues/152)  
**影响面**：远程 Vault 文件树右键 → 新建文件 / 新建文件夹  
**状态**：已修复

## 现象

- 远程连接成功、文件树正常，但右键「新建文件夹 / 新建文件」确认后失败（Toast 报错），本地 Vault 正常。
- 后端 `remote_mkdir` / `remote_write_text` 本身可用；问题在前端创建前预检。

## 根因

`confirmCreate`（`src/lib/vault/actions.ts`）在创建前用 `@tauri-apps/plugin-fs` 的 `exists(full)` 判断重名：

```ts
const { exists } = await import("@tauri-apps/plugin-fs");
if (await exists(full)) { … }
```

远程路径是伪句柄 `remote:<sessionId>/rel/path`，不在本机 FS scope 内。`exists` 会抛 scope/路径错误（或无法正确反映远端状态），整次创建被 `catch` 吃掉，表现为「无法新建」。

写路径本身（`createVaultDirectory` / `writeVaultFile`）已正确分流到 `remote_mkdir` / `remote_write_text`。

## 修复

1. 新增 `vaultPathExists`（`src/lib/vault/fs.ts`）：
   - 本地：继续 `plugin-fs` `exists`
   - 远程：`remote_list` 父目录，检查 basename 是否已存在
2. `confirmCreate` 改为调用 `vaultPathExists`。
3. 辅助 `splitVaultRel` + 单测 `test/vault-fs-exists.test.ts`。

## 验证

- 远程 Vault：在根或子目录新建文件夹 / 空 Markdown，应成功并刷新树。
- 同名再创建：应提示已存在，而非 scope 错误。
- 本地 Vault：新建与重名预检行为不变。
