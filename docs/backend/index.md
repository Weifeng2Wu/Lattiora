# Cloudflare 后端

运行时入口为 `cloudflare/worker.ts`，D1 migrations 位于 `cloudflare/migrations/`，不可变文件对象位于 R2。原 Rust Host 和 CLI 已移除。

- [架构与一致性](../architecture.md)
- [部署、安全、费用和恢复](../deployment/cloudflare.md)
- [原功能迁移与限制](../deployment/capabilities.md)

## API

所有 `/api/*`（登录 POST 除外）要求会话；写入要求相同 Origin。统一错误响应 `{error: code}`，数据接口均为 `Cache-Control: no-store`。

| 接口 | 行为 |
|---|---|
| GET/POST/DELETE /api/session | 检查、登录、退出 |
| GET /api/session | 返回工作区 UUID，上传前核对 |
| GET /api/changes?after=seq | 按单调序号分页返回文件及 tombstone |
| GET/PUT /api/file | 按 path/版本读写；409 表示版本冲突 |
| PUT /api/blobs/:uuid | R2 幂等不可变对象上传 |
| GET/PUT/DELETE /api/ai/config | 读取无 key 的配置、加密保存、删除 |
| POST /api/ai/chat | 统一 SSE delta/done/error；支持中止上游 |
| POST /api/ai/translate、/api/ai/ocr | 统一模型翻译/视觉文本 |
| GET /api/lookup、/api/remote-pdf | 学术 metadata 与公开 PDF 下载 |

准确参数和限制以 `src/lib/cloud/protocol.ts` 及对应 Worker handler 为准。浏览器 data API 通过 `cloud/commands.ts` 适配原 UI 类型；不支持的旧操作抛错。
