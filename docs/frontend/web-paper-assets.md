# 网页论文资源下载

恢复原 Library 右键「Download all incomplete paper assets」，单篇下载与批量下载复用浏览器资源实现。缺 PDF 时下载 PDF；arXiv 缺 TeX 时通过登录保护 Worker 获取源归档，在浏览器解包到 `{paper}/source/`。identifier 入库也使用同一实现。批量最多两个下载活动并行，可在原任务面板取消单项；重复操作跳过已有资源。下载期间关闭页面会中断活动，重新点击只补仍缺失项，不宣称下载任务能在页面关闭后继续运行。

保留原树只展开 `attachments` 的设计；原 Quick Open（Ctrl/Cmd+P）新增按文件路径搜索，输入 `论文ID/source/main.tex` 即可用原 CodeMirror 编辑/离线保存。`.tex` 编辑器工具栏支持[正文与公式实时预览](latex-preview.md)。Markdown 内容搜索仍保留，源码不会为搜索无条件整库读取。TeX 原生编译不迁移为假成功；用户可导出源码交外部编译器，已导入的编译 PDF 仍可查看。

支持 gzip TAR、POSIX/GNU 长文件名和 PAX 路径、gzip 单文件 TeX。拒绝符号链接/硬链接等特殊条目、路径越界、重复路径、无效校验和及非源码 HTML/PDF 响应。Worker 归档压缩体上限 32 MiB，浏览器展开 64 MiB、2000 文件；超出明确失败。归档安全验证通过后在一个本地事务写入全部源文件，检查论文 metadata 和目标版本；不覆盖已有源文件。云端仍按各文件 CAS 上传，并不声称跨文件云端原子提交。

源目录中的 PDF 插图不再被识别成论文主 PDF。外部 PDF/源下载失败保留已经成功的资源和论文 metadata，并显示错误，可重试。源文件随普通文件同步和备份；API 不暴露本机路径、命令或客户端模型 Key。

实际验证见 `docs/test/cloudflare.md`。arXiv 不保证每篇提供源码或始终允许 Cloudflare 出站；无源码论文需上传/导入用户有权使用的原文件。
