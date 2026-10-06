# 网页阅读热力图

保留原论文库标题下的 ReadingTitleHeat 色带和 24 桶聚合算法。热力图来自同步的 `papers/<paper>/marks/*.json`，不是阅读时长遥测；按原版 b6320ce5 的活动读取规则，highlight/translate 权重为 1，ask 为至少 1 的非 system 消息数量，纵向位置取 rects 中点平均值。复用现有三个 mark schema 校验器与 meanRectY，忽略未知/损坏文件及 aggregate annotations.json。

修正此前简化读取器缺少 kind、误用 mark.rect.y、遗漏 ask.anchor.page、忽略对话强度的问题。一次遍历本地文件表批量读取；标注新增/修改/删除及跨设备同步通知会使相关论文的缓存失效，保持原 Library UI 即时更新。颜色仍按原算法相对峰值归一化，不代表绝对阅读时长。

页数按原需用时探测和缓存机制获取；现在用完即关闭 headless PDF，避免每次探测留下 PluginRegistry/打开文档。页数未知时仍使用最大观测页，不需要下载 ONNX 或调用模型 API。

验证：原聚合与浏览器存储/页数生命周期测试共 3 文件、12 项通过。生产构建 + Wrangler 浏览器通过（28 秒）：原 Library 显示远端同步的问答标注色带、离线重启保留、远端删除后重连移除色带。mark 数据为测试 fixture；文件传输/IndexedDB/原 UI 与聚合为真实实现。阅读时长事件仍是设备本地 IndexedDB 活动日志，当前不把它伪称为跨设备热力图数据源。
