# macOS 主窗口可无限缩小（平台配置合并冲掉 minSize）

## 现象

macOS 上主窗口可以缩到远小于设计下限（`960×520`），布局挤坏；`tauri.conf.json` 里虽已写 `minWidth` / `minHeight`，运行时却不生效。

## 根因

Tauri 平台配置按 **JSON Merge Patch（RFC 7396）** 合并：对象按 key 合并，**数组整体替换**。

`tauri.macos.conf.json` 曾只覆盖 overlay 标题栏相关字段：

```json
"windows": [
  {
    "visible": false,
    "hiddenTitle": true,
    "titleBarStyle": "Overlay",
    "trafficLightPosition": { "x": 14, "y": 18 }
  }
]
```

这会整段替换主配置里的 `app.windows`，导致 macOS 上丢失：

- `minWidth` / `minHeight`（无最小尺寸）
- `dragDropEnabled: false`（回退为默认 `true`）
- `width` / `height` / `title` 等（回退默认值）

官方说明：[Configuration Files — Platform-specific](https://v2.tauri.app/develop/configuration-files/#platform-specific-configuration)：`app.windows` 等数组元素不会字段级合并，省略的字段走默认值，而不是基座配置。

## 修复

在 `tauri.macos.conf.json` 的 `windows[0]` 中**重复写齐**基座窗口字段（含 `minWidth` / `minHeight` / `dragDropEnabled` / 初始尺寸），再叠 macOS overlay 项。

新窗口（`window_new`）走 `WebviewWindowBuilder::min_inner_size`，不受此合并影响；问题只出在配置创建的 `main` 窗口。

## 防再发

改 `tauri.*.conf.json` 的 `app.windows` 时，把基座里需要保留的字段一并抄进平台文件，或把平台专用项（如 `titleBarStyle`）尽量放进基座（其它平台会忽略）。
