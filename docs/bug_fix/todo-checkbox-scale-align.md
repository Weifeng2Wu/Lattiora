# 界面缩放时待办 checkbox 与文字错位（#143）

**状态**：已修复（首行 `1lh` 垂直居中 + 缩进改 `rem`）  
**影响面**：Markdown 编辑器待办列表（task list）勾选框与正文对齐；列表缩进在 `uiScale ≠ 1` 时与 marker 间距  
**相关代码**：

- `src/components/editor/block-list.tsx` — `TodoLi` checkbox 定位
- `src/components/editor/plugins/markdown-editor-kit.tsx` — `IndentPlugin` offset / unit
- `src/components/editor/paragraph-node.tsx` — 段落 `py-1`（首行对齐依赖）
- `src/hooks/use-app-bootstrap.ts` — `uiScale` → `documentElement.fontSize`

**Issue**：[#143](https://github.com/agentero-ai/motif/issues/143)

---

## 1. 问题现象

系统显示缩放或应用 UI 缩放不为 100%（例如 Windows 125%）时，待办列表左侧勾选框与同一行文字垂直错位（文字偏上或偏下）。

任意含 `- [ ]` / `- [x]` 的 Markdown 文件即可复现。

---

## 2. 根因

### 2.1 魔法数绝对定位

`TodoLi` 沿用 Plate playground 模板写法：checkbox 自身 `absolute top-1 -left-6`。

- `top-1`（0.25rem）只是把框顶「顶」到接近段落 `py-1` 的位置，**并不**按首行行高居中。
- 正文首行盒 = 段落 `padding-top` + `line-height`（根上约 1.5 → `1lh`）；勾选框高度为 `1rem`。用固定 `top` 对齐在 100% 下可能「看起来差不多」，在非整数 DPR / 非 100% `uiScale` 下亚像素取整后错位更明显。

### 2.2 缩放机制本身

应用缩放通过改根字号实现：

```ts
document.documentElement.style.fontSize = `${16 * uiScale}px`;
```

`rem` 会跟着变；若缩进仍用固定 `px`，则 checkbox 的 `-left-6`（1.5rem）与 `IndentPlugin` 的 `offset: 24`（px）在缩放后不再一致，嵌套列表时水平方向也会漂。

系统级显示缩放（Windows 125% 等）还会引入非整数 `devicePixelRatio`，进一步放大「凭感觉写的 top」的误差。

---

## 3. 修复

### 3.1 首行盒内垂直居中（且不要重复算 padding）

Plate 的 `belowNodes` 包在 **块元素内部**（例如带 `py-1` 的 `<p>` 里面），因此：

```text
p.py-1          ← padding 已在外层
  ul > li
    checkbox    ← 已在 content box 顶边，与文字同一起点
    text
```

槽位必须是 **`top-0` + `h-[1lh]` + `flex items-center`**。  
若再写 `top-1`（Plate 模板 / 误以为要对齐 `py-1`），会把「居中偏移」算两次，勾选框整体偏下、文字显得偏上——缩放后更明显。

### 3.2 缩进与 marker 共用 rem

`IndentPlugin`：`offset: 1.5, unit: "rem"`（100% 下仍等于原先 24px），与 todo 的 `-left-6`、有序列表 `ps-[1.5em]` 同一量级。

---

## 4. 相关但未一并改动的点

| 点 | 说明 |
|---|---|
| 有序 / 无序 marker | 浏览器原生 `list-style`，一般随字体度量对齐；若仍有个别字体错位可再调 `list-outside` 间距。 |
| 待办用在 heading 等块 | 槽位按段落 `py-1` + `1lh` 校准；标题行高/padding 不同时可能略偏，实际任务列表几乎都在段落上。 |
| Plate 上游模板 | 官方 `block-list` 仍是 `top-1`；本仓库已分叉修正。 |

---

## 5. 验证建议

1. 设置 → 外观 → UI 缩放 100% / 125% / 150%，打开含多行待办的笔记。
2. Windows 显示缩放 125% 下再看一眼（与 #143 环境一致）。
3. 嵌套缩进待办：勾选框与正文水平间距应随缩放保持一致。
