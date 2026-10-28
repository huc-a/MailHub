# MailHub

基于实施文档 v2.0 的 Cloudflare 私有邮箱工作台，目前按单所有者模式开发。

## 本地开发

1. `npm install`
2. 将 `.dev.vars.example` 复制为 `.dev.vars`。本地模拟身份只用于开发，禁止在生产环境启用。
3. `npx wrangler d1 migrations apply mailhub-dev --local`
4. `npm run dev` 或 `npx wrangler dev`
5. `npm test`、`npm run build`

本地 API 请求使用 `X-MailHub-Local-Subject` 模拟 Access 身份。生产 API 必须配置 Cloudflare Access，并设置 `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`。

## 当前实现

- Cloudflare Worker、Vue 前端、D1/R2 绑定和 D1 初始迁移。
- 临时邮箱创建、幂等键、续期、逻辑删除、过期清理与任务重试。
- Cloudflare Access JWT 校验、邮件列表/详情/本地已读、授权附件下载。
- 收件箱按邮箱、来源、已读状态筛选；按主题/发件人搜索，并使用稳定游标继续加载较早邮件。
- MIME 大小限制、正文/附件限额、D1/R2 分阶段入库、HTML 净化和 CSP 隔离。
- Gmail 只读 OAuth/PKCE、Access Token 交换、加密保存 refresh token，只读 Gmail API 提供器、初次窗口同步、History 增量任务和账号租约。附件暂不从 Gmail 同步。

## Cloudflare 资源

生产站点：[https://ear1.de5.net](https://ear1.de5.net)，由 Cloudflare Access 限制为所有者邮箱。Worker 自定义域名和 Email Routing catch-all 已启用；有效临时邮箱收件入库，未命中地址继续转发到原已验证地址。MX、SPF、DKIM 记录保留。详情见 [生产收件路由](docs/生产收件路由.md)。

生产 Worker 当前绑定 D1 `mailhub-dev`（ID `d71b8456-203f-4da0-ad0b-5bab7e7fd915`）和 R2 bucket `mailhub-dev`；该账户资源仍是开发命名，尚未拆分独立 staging/prod 资源。Gmail OAuth 客户端和令牌加密密钥尚未配置，因此真实 Google 账号连接/同步暂不可用；Gmail 附件同步也尚未实现。

密钥请使用 Wrangler Secrets 或本地 `.dev.vars`，不得提交到 Git。生产 OAuth 至少需要 `APP_BASE_URL`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` 和 base64 编码的 32 字节 `TOKEN_ENCRYPTION_KEY`。
