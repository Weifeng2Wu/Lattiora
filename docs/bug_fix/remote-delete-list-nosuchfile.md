# 远程 Vault：删除文件夹后 list 报 NoSuchFile

**影响面**：远程 Vault 文件树删除文件夹 / 文件后的刷新  
**状态**：已修复  
**相关代码**：

- `src/lib/vault/tree.ts` — `isPathMissingError` / `listTreeEntries` / `removeTreeNode` / 远程建树
- `src/lib/vault/store.ts` — `refreshTree` / `loadDirChildren`
- `src/lib/vault/actions.ts` — `trashPathsAndNotify` 乐观剪枝
- `src/lib/vault/index.ts` — 导出
- `test/vault-tree.test.ts` — `isPathMissingError`、`removeTreeNode`
- 产品约定：[`../frontend/vault-tree.md`](../frontend/vault-tree.md)
- 远程 trash：`src-tauri/src/features/remote/trash_bridge.rs`（写路径本身正常）

---

## 1. 现象

远程 Vault 右键删除文件夹（例如 `papers/test`）后出现 Toast：

```text
sftp list /home/…/papers/test: Sftp server reported error kind NoSuchFile, msg: Err Message: No such file, Language Tag:
```

- 侧栏文件树可能被**整栏清空**，或刷新失败后状态异常。
- 同一操作在**本地 Vault** 上无此问题。
- 远端磁盘上目标往往已进回收站（删除写路径成功），问题出在**删后刷新树**。

---

## 2. 根因

### 2.1 本地 vs 远程建树语义不一致（主因）

**本地** Host（`features/vault/tree.rs`）对子目录 `read_dir` 是 best-effort：

```rust
// Best-effort: unreadable subdirs yield an empty listing, not a hard error.
let entries = match fs::read_dir(dir) {
    Ok(entries) => entries,
    Err(_) => return Vec::new(),
};
```

**远程** 前端（`src/lib/vault/tree.ts`）对每次 `remote_list` 硬失败：任一路径 `NoSuchFile` 整次 `loadVaultTree` 抛错。

### 2.2 删除后的调用链

```text
trashPathsAndNotify
  → path_trash（远程 rename/copy 到 .agentero/.trash/）  // 可成功
  → refreshTree → loadVaultTree
      → 对 papers/ 等 eager 树递归 remote_list
      → 若仍 list 到已删除的 papers/test → SFTP NoSuchFile → 整树失败
```

常见触发：

- 并发刷新：上一次建树尚未走完，路径已被移入回收站；
- 懒展开 / 刷新窗口内仍访问已消失节点。

写路径本身（`path_trash` → `trash_bridge`）与本地回收站语义一致；**不是** trash 协议失败。

### 2.3 失败时清空侧栏

原 `refreshTree` catch：

```ts
notifyError(message);
setTree([]); // 整栏空白，Toast 即 sftp list 原文
```

---

## 3. 修复

与本地 Host 对齐：**缺失路径 = 空列表 / 剪掉节点**，而不是整树失败。

| 改动 | 位置 | 行为 |
|------|------|------|
| `isPathMissingError` | `tree.ts` | 识别 NoSuchFile / not found / ENOENT / does not exist |
| `listTreeEntries` | `tree.ts` | list 遇 missing → `[]`，其它错误仍抛出 |
| `removeTreeNode` | `tree.ts` | 从内存树不可变删除节点及子孙 |
| 乐观剪枝 | `actions.ts` `trashPathsAndNotify` | trash 成功后先 `removeTreeNode`，再 `refreshTree` |
| 懒展开 | `store.ts` `loadDirChildren` | missing → 安静移除节点，不 Toast sftp 原文 |
| 刷新失败 | `store.ts` `refreshTree` | **保留旧树**，仅 Toast，避免侧栏空白 |

### 3.1 远程 list best-effort（核心）

```ts
export function isPathMissingError(error: unknown): boolean {
  const msg = (/* … */).toLowerCase();
  return (
    msg.includes("no such file") ||
    msg.includes("nosuchfile") ||
    msg.includes("not found") ||
    msg.includes("enoent") ||
    msg.includes("does not exist")
  );
}

async function listTreeEntries(/* adapter, dir, rel */) {
  try {
    return await adapter.list(dirPath, rel);
  } catch (e) {
    if (isPathMissingError(e)) return [];
    throw e;
  }
}
```

`buildTree` / 论文 `source/` 探测均走 `listTreeEntries`，不再直接裸调 `adapter.list`。

### 3.2 删除后乐观剪枝

```ts
await trashPaths(vaultPath, rels);
// …
let pruned = vaultStore.getState().tree;
for (const p of valid) pruned = removeTreeNode(pruned, p);
setTree(pruned);
await refreshTree(vaultPath);
```

UI 立即去掉目标；随后全量刷新与远端一致。

### 3.3 展开与刷新容错

- **展开**已删除路径：`loadDirChildren` catch missing → `removeTreeNode`，无错误条。
- **刷新**其它错误：Toast 说明，**不** `setTree([])`。

---

## 4. 验证

| 场景 | 期望 |
|------|------|
| 远程：新建空文件夹 → 删除 | 节点消失，无 NoSuchFile Toast；兄弟目录仍在 |
| 远程：删除非空夹 / 论文夹 | 同上；库表 / 标签页同步关闭相关资源 |
| 远程：删除后立刻再刷新（⌘R） | 树与远端一致，不整栏清空 |
| 本地删除 | 行为与修复前一致 |
| 单测 | `test/vault-tree.test.ts`：`isPathMissingError`、`removeTreeNode` |

---

## 5. 决议

| 议题 | 决议 |
|------|------|
| 是否改 SFTP `list` 在 Host 层吞 NoSuchFile | **否**：仅树构建层 best-effort；写路径 / trash 仍需真实错误 |
| 刷新失败是否清空树 | **否**：保留旧树，避免远程抖动抹掉侧栏 |
| 删除是否等全量刷新再更新 UI | **否**：先乐观剪枝，再 refresh 对齐远端 |
