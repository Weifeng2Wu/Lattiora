# HTML 论文阅读迁移

原 `HtmlViewer`、选区菜单、翻译卡、问答卡和快捷键继续使用；桥接脚本移植自 `b6320ce5 src-tauri/src/features/web/proxy.rs`。删除不再使用的 `agentero-arxiv://` / `agentero-web://` URL 构造与旧平台测试。此前界面仍调用不存在的 `webProxyAllowHost`，arXiv 也指向已移除的原生协议；现统一读取公共 HTTP(S) HTML。

浏览器复用有登录保护的 `/api/feeds/fetch`，Worker 限制大小为 2 MiB、20 秒超时、验证每一跳公开地址，且不转发用户 Cookie/模型 Key。HTML 原文保存到 `.agentero/web-pages/<url-sha256>.json`，可离线重开并随备份/同步保留。网络刷新失败保留之前的缓存。

DOMPurify 清理网页脚本、事件属性、frame/object/form、上游 CSP 与 base。保留正文、内嵌样式及公开样式/图片链接；只注入应用自己的原选区桥接。呈现使用 Service Worker 的本地 `/_reader/<uuid>` 临时缓存响应，并通过响应头 `Content-Security-Policy: sandbox allow-scripts` 建立 opaque origin，同时限制 nonce 脚本、禁用 connect/form/frame。脚本消息必须同时匹配 iframe 的 Window 和 `origin=null`，不只检查 source 字符串。

这里不能使用 `srcdoc`（会继承应用 CSP，阻止原网页样式和桥接），也不能再加 iframe sandbox 属性（Chromium 会在初始导航时绕过 Service Worker）。沙箱由响应头在解析前强制；真实浏览器断言父窗口 DOM 访问抛出异常、恶意脚本和 onerror 均不执行。临时呈现缓存至多 32 份，关闭视图时删除；持久 HTML 原文单独保存在 IndexedDB。

同站点链接由父页面重新获取并保持选区桥接；其他站点交给系统浏览器。无法读取时显示现有错误提示和打开原站的图标入口。无本机地址、SSH 或原生命令。

## 当前范围与限制

这是公共静态 HTML 阅读，不声称能复现任意外站的脚本应用：需要登录、验证码、脚本生成正文的页面应在原站打开。外部样式、图片和字体目前没有独立离线缓存，离线保留正文及内嵌样式；页面超过 2 MiB 会明确失败。Plaza 外站列表导航/入库是独立消费者，仍需接回，不能把修复 HTML 论文阅读等同于整个 Plaza 迁移完成。

## 验证

`test/cloud-html-reader.test.ts` 验证离线缓存、失败刷新保留、凭据 URL/非 HTTP 协议/非 HTML 响应拒绝；原 `web-view-bridge-message` 契约测试保留。`test/browser/html-reader.spec.ts` 在生产构建 + Wrangler 验证原 JSON 论文导入/HTML 视图、内嵌样式、隔离、恶意脚本拦截、原选区菜单、同站点导航及离线重载。上游为受控 HTML fixture，浏览器真实执行。重启前遗留的原生 URL 构造测试由以上行为验证替代。
