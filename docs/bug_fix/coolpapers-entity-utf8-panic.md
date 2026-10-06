# Cool Papers：`decode_entities` 切中文 panic + 广场每次新建连接

日期：2026-08-15

## 现象

- 广场里打开 papers.cool 明显卡顿；日志里每次请求都是 `No cached session` + 立刻 `CloseNotify`。
- 「获取 Cool Paper 笔记」有时失败。Host 线程 panic：

```
end byte index 12 is not a char boundary; it is inside '返' (bytes 11..14 of string)
  at features/coolpapers/mod.rs decode_entities
```

## 原因

1. **笔记 / 入库解析**把 HTML 实体解码写成 `tail[..len.min(12)]`。`&` 后面若是中文（`R&D返回`、`A&测试`），第 12 个字节落在三字节汉字中间，切片即 panic，tokio worker 直接死掉，前端表现为「获取不到」。
2. **广场站点代理**每个资源都 `Client::builder().build()`。走系统代理（如 `127.0.0.1:7890`）时每次都是新 TCP + 新 TLS，session 无法复用，所以页面（HTML/CSS/JS/图片）一卡一卡。

## 修复

- `decode_entities` 按 `char_indices` 找 `;`，不再按字节硬切。
- `network::shared_client()` 按当前代理缓存一个带连接池的 reqwest Client；广场代理和 Cool Papers 拉取共用。代理设置变更时作废缓存。
