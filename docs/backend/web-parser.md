# 网页 PDF 解析服务

设置沿用原布局/正文解析卡片，两种用途独立选择。Paddle 和 MinerU 的 HTTP 请求/结果字段对照原 `src-tauri/src/features/paper/analyze/layout/hosted/` 与 `body_engines/` 实现。

- Paddle：multipart 上传整份 PDF；布局使用 `PP-StructureV3`，正文使用所选模型（默认 `PaddleOCR-VL-1.6`）。轮询 OCR job，读取 JSONL 页面、渲染尺寸、检测框和 Markdown。
- MinerU：申请 v4 batch 预签名上传 URL，PUT PDF，轮询 extract-results，下载 ZIP。语言与 force OCR 字段保留。浏览器解包 `content_list.json`、`middle.json`/`layout.json`、`full.md` 和 images，归一化页面检测框；正文图片随论文保存。
- OpenAI-compatible VLM：浏览器渲染每一页，通过 Worker 的独立 key/base URL/model/prompt 识别；发送正确的 PNG/JPEG MIME。统一 AI（agentero）支持部署的 Anthropic/OpenAI 协议。指定 VLM 正文解析处理所有页面，不仅扫描页。
- local：现有 PDFium 文本提取与统一 AI 扫描页识别；原精细 ONNX 版面识别尚未恢复，不能当作与原 ONNX 等价。

## 恢复、冲突与限制

`0004_parser_jobs.sql` 保存任务状态与请求指纹；provider凭据、上游任务 ID、预签名 URL 加密。浏览器提交前保存请求 UUID，重启后可恢复同一任务的轮询。重复提交同一 UUID/内容不会创建第二份任务，内容不匹配返回409。GET请求对临时错误指数退避；中断后重新执行普通解析可读取原任务/已缓存结果。强制重新解析创建新任务。

上游可能已经受理但提交响应丢失时，状态为 uncertain，不自动重复可能计费的提交。界面提示先核查供应商控制台。取消停止浏览器请求与等待，无法保证取消供应商已经受理的工作。页面关闭后供应商作业可以继续，但浏览器恢复后才继续拉取和落盘；没有伪装为后台 Worker 常驻进程。

结果在 R2 缓存，并同步到本地文件缓存；PAPER.md 与图片写入校验解析前的本地修订，并发修改保留冲突副本。原“清除解析结果”先原子复制到 `Backups/parse-*` 再删除；重新解析通过任务面板串行执行，保留取消/失败状态。

针对 Workers 128 MiB 内存：整份远程 PDF 上限16 MiB，供应商下载结果16 MiB，ZIP 单项16 MiB、解压总量64 MiB、最多4000项。解包在浏览器执行，检查实际解压字节及路径穿越。过大的文档应拆分后导入，不会返回空结果伪装成功。原正文图像资产保留；Paddle 原接口只提供的外部图片引用仍受供应商链接有效期限制。

解析服务计费独立于 Cloudflare。每5秒轮询一次，每次恢复等待最多15分钟，超时保留任务供后续检查。D1、R2 和网络请求消耗Cloudflare额度，不能承诺大型PDF满足免费档10ms CPU预算。结果缓存暂不自动GC，需纳入R2用量与备份管理。

真实密钥缺失时，只能完成 workerd + D1/R2 + HTTP协议夹具验证及浏览器模拟结果验证；不得将它报告成供应商生产可用性或识别质量验收。
