# 自动版面分析入口

源码消费者复核发现 `use-pdf-layout-run` 和全文翻译等待链仍调用原 `jobLayoutAnalyzeEnqueue`，而原生 JobCenter 已移除。现将该入口接到浏览器 `runLocalActivity`，继续运行原 headless 分析及已有配置解析器、进度、取消和失败任务面板。

同论文在当前标签页复用在途 Promise；跨标签使用 Web Lock，拿锁后重新检查 `source/layout.json`，防止重复请求。不同论文串行执行以限制 PDFium/模型内存。失败释放锁和去重记录，再次打开论文或执行分析可重试；有效分析结果按原 sidecar/outbox 同步。任务本身不是云端持久执行租约，关闭浏览器不在服务器继续运行；重新打开后缺少结果会重排。

移动阅读器同步补齐 `paperAbsPath`，使自动分析、依赖工作区路径的阅读操作接到云文件边界。移除打开论文时无消费者的 native `jobFocusPaper` 调用。

验证：2 项队列测试覆盖去重、取消信号传递、缓存复查和失败后重试/释放订阅；生产构建 Chromium 从移动原列表打开 PDF，不点击 Analysis，确认自动生成非空 layout.json 并实际同步 Worker，然后继续验证离线笔记与冲突保留（约 1.5 分钟）。该测试实际使用 local ONNX，核实生成文件 `source.mode=embedpdf-layout` 且有 1 个区域；不由单页测试推断模型质量或付费解析服务可用性。
