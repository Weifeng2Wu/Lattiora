# 左侧栏收起/展开后文件树跳回顶部、动画期间抖动

**状态**：已修复（#576）
**影响面**：左侧 Vault 文件树的滚动位置（左栏 rail 收起/展开、点击选中行、折叠/展开目录）
**相关代码**：

- `src/components/sidebar/file-tree/hooks/use-tree-reveal.ts` — reveal 改 `align: "auto"`；ResizeObserver 只在高度变化时同步 virtualizer；0 宽收起期间保存/恢复 `scrollTop`
- `src/components/sidebar/file-tree/hooks/use-tree-expansion.ts` — `setExpandedFromTree`：用户折叠时 arm reveal 抑制
- `src/components/sidebar/file-tree/file-tree.tsx` — `AiFileTree.onExpandedChange` 接上面的包装

---

## 1. 问题现象

- 左栏（rail）收起再展开后，文件树回到最上方，滚动位置丢失。
- rail 收起/展开的 200ms `flex-grow` 过渡期间树内容抖动。
- 点击选中靠近树顶部的行（papers/、回收站）时，整棵树平滑滚回顶端。

## 2. 根因

三层叠加：

1. **定位用了 `align: "center"`**：`scrollToIndex` 把目标行强制居中。目标行在树顶（如回收站行、第一篇论文）时，居中即滚到 `scrollTop ≈ 0`，表现为“跳转到最上方”。VS Code `List.reveal` 的默认语义是最小滚动、行已（部分）可见则完全不滚。
2. **ResizeObserver 对任何尺寸变化都 `scrollToOffset(el.scrollTop)`**：rail 动画期间树的滚动容器**宽度**逐帧变化，回调每帧读几何（WebKit 过渡中途可能返回被钳制的 `scrollTop`，0 宽时甚至归零）再每帧写回 `scrollTop` 并触发 virtualizer 的 reconcile rAF 循环——读写互搏表现为抖动，且把中途读到的 0 固化成最终位置。该回调本是为“Paper Info 挂载导致视口**高度**变化时 WebKit 无声钳制 scrollTop”加的（见 [vault-sidebar-blank-until-scroll.md](vault-sidebar-blank-until-scroll.md)），宽度变化本不需要它。
3. **扁平行集每次变化（每次展开/折叠目录）都全量 `rowVirtualizer.measure()`**：清空整个行高缓存后所有行回到估算值、逐行重测并重放 first-measure 滚动修正。WebKit 没有原生 scroll anchoring（`overflow-anchor` 仅 Safari TP 实验）吸收这些修正，放大成可见的行抖动。稳定 `getItemKey` 本就保证缓存行高跨插入/删除有效，全量重估没有必要。

另有一个窗口期问题：用户通过 chevron 折叠“包含当前选中文件”的目录时，flatRows 驱动的自动定位可能立刻把祖先重新展开（定位尚未落地时），表现为目录“折叠不住”。

## 3. 修复

1. **reveal 改 `align: "auto"`**（VS Code 语义）：行已可见不滚；在视口上方→顶部对齐；在下方→底部对齐；从不居中。
2. **ResizeObserver 分流**：只在高度变化（Paper Info 开合等）时同步 virtualizer；宽度变化不写 `scrollTop`。rail 收起至 0 宽前用 passive `scroll` 监听持续记录位置，重新展开（0→正宽度）时若 WebKit 丢了位置则恢复。
3. **`measure()` 只在 `uiScale` 变化时执行**，展开/折叠/刷新依赖稳定 key 的缓存行高。
4. **用户折叠优先于自动定位**：`AiFileTree.onExpandedChange` 走 `setExpandedFromTree`，集合变小时 arm `suppressAutoRevealRef`，flatRows 驱动的 reveal 消费一次后不再重新展开。

## 4. 验证注意

- `pnpm tauri dev`（WKWebView）：把文件树滚到中下部 → ⌘B 收起/展开左栏，树应保持原位、无抖动。
- 点击树上任意可见行不应引起滚动；打开回收站 / papers 后树不应跳回顶部。
- 折叠包含当前选中文件的目录应保持折叠（不回弹）；随后打开新文件仍会正常定位。
- 缩放（uiScale ≠ 1）后反复展开/折叠目录，行不应上下跳。
