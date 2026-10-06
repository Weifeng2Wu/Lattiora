# 论文广场原站交互迁移

以 `b6320ce5` 的 Cool Papers / ModelScope 原代理注入脚本为基准，保留原 Plaza 面板、历史导航和站内入库按钮。在线站点分别运行在独立 Worker 域名，使用原站 HTML、JavaScript、分页和浏览器存储；主应用 IndexedDB、模型密钥和登录 Cookie 不提供给外站脚本。Cool Papers 静态缓存继续用于离线导航及入库后的阅读，ModelScope SPA 不宣称可离线运行。

主应用 `POST /api/plaza/session` 验证登录后签发六小时 HMAC 授权，限定父页面和代理域名及站点。代理将授权换成 HttpOnly Cookie，随后跳转到无授权参数的路径。HTTPS 使用 Secure / SameSite=None / Partitioned；禁用第三方 Cookie 且不支持分区 Cookie 的浏览器可能无法在线使用代理。主界面错误通过 i18n Toast 显示，可刷新重取授权。

代理只向固定 `papers.cool` 或 `modelscope.cn` 请求，不跟随服务端跨站重定向；不转发主应用 Authorization 或代理授权 Cookie。POST/PUT 要求代理自身 Origin，限制请求体，禁止注册原站 Service Worker。ModelScope 部分查询使用 PUT，因此不能只允许 GET/POST。原站登录账户、付费权限及绕过验证码不在迁移范围内。原站自有功能与第三方脚本仍依赖公网可用性。

## 部署

除主 Worker 外，部署 `wrangler.plaza-coolpapers.jsonc`、`wrangler.plaza-modelscope.jsonc` 两个 Worker，无新增 D1/R2。两个配置的 `APP_ORIGIN` 指向主应用 HTTPS origin；主配置的 `PLAZA_COOL_ORIGIN` / `PLAZA_MODELSCOPE_ORIGIN` 指向各自独立 HTTPS origin。三个 Worker 的 `ENCRYPTION_KEY` 必须一致，通过 Wrangler Secret 写入，不能提交到配置。独立代理仅使用其派生 HMAC 密钥，不提供设置或文件 API。

```sh
node scripts/cloudflare.mjs secret put ENCRYPTION_KEY --config wrangler.plaza-coolpapers.jsonc
node scripts/cloudflare.mjs secret put ENCRYPTION_KEY --config wrangler.plaza-modelscope.jsonc
node scripts/cloudflare.mjs deploy --config wrangler.plaza-coolpapers.jsonc
node scripts/cloudflare.mjs deploy --config wrangler.plaza-modelscope.jsonc
pnpm deploy
```

首页及 `/index.html` 经主 Worker 按配置生成允许代理域名的 CSP；静态资源仍走 Assets。修改代理域名后重开在线首页更新离线缓存。代理每个动态页面/资源会消耗 Worker 请求与上游请求额度，额度按 Cloudflare 账户合并计算，不能把三个 Worker 当作三份免费额度。没有新增内置模型 API。

## 本地验证

使用三个端口运行主 Worker 和两代理，覆盖同名 `APP_ORIGIN` / `PLAZA_*_ORIGIN`，三个环境使用同一个本地密钥。主应用默认拒绝使用开发授权导航到线上代理。

`test/cloud-plaza-proxy.test.ts` 覆盖签名、过期/跨站拒绝、跳转、Cookie/Header 隔离、固定上游以及原注入脚本语法。`test/browser/plaza-live.spec.ts` 需设置 `AGENTERO_PLAZA_COOL_URL`，使用实际本地登录和代理授权 Cookie，仅替换公网 HTML/PDF fixture，验证脚本存储、入库、原导航与离线缓存；这不等于真实上游全部功能验收。
