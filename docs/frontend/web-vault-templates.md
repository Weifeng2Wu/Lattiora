# Vault 模板播种与升级

原版六篇中英教程和 `thesis/main.tex` 已恢复到模板；教程保留原功能结构，修正本机 ACP、Zotero Connector、catalog.sqlite 的说明为统一 Agent、标准导入和每论文 metadata。TeX 示例可在原源码编辑器离线编辑/导出，编译使用外部 LaTeX 服务，不声称 Workers 能运行 TeX。

初始化时，AGENTS.md、内置 Skills 与附属资源、教程、thesis 示例统一经过模板安装器。`.agentero/template-manifest.json` 记录已安装字节的 SHA-256。新模板只更新与上次已安装哈希一致的文件；用户修改、删除及占用目录路径的普通文件均保留。没有历史 manifest 的旧文件，只有与当前模板完全相同时才认领，不能推断用户是否改过并强制覆盖。

同一设备的文件与 manifest 在 Web Lock 下单个 IndexedDB 事务提交，outbox 随事务持久化；初始化幂等。云端仍逐文件 CAS，同步冲突保留副本，不声称跨文件云事务。用户删除的模板不会在下次启动时重新出现。

测试覆盖未修改升级、已修改保留、删除不复活、旧文件认领、损坏 manifest 拒绝、父路径冲突保护。UI 验证从原文件树/Quick Open 访问示例；无需新增模板管理界面。
