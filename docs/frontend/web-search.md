# 网页 Quick Open

原 Ctrl/Cmd+P 组件保留，`searchVault` 改为查询 IndexedDB 工作副本，修复旧 `vault_search` 未接入导致无匹配的问题。搜索包含文件路径及 Markdown 内容，离线可用；按路径查找 TeX、图片等文件不读取全部二进制内容。隐藏配置文件不参与搜索。

库内 `NOTES.md` / `PAPER.md` 内容命中仍打开原论文工作流；源码、附件和其它文件路径命中直接打开该文件。查询失败用 Toast 显示，不再吞异常伪装无结果。源码文件沿用原 CodeMirror，详见 web-paper-assets。

`test/cloud-search.test.ts` 检查源码路径、库内笔记归属和隐藏文件排除；`test/browser/paper-assets.spec.ts` 覆盖原 Quick Open → TeX → 断网编辑 → 刷新 → 恢复同步。
