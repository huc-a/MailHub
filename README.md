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
- MIME 大小限制、正文/附件限额、D1/R2 分阶段入库、HTML 净化和 CSP 隔离。
- Gmail 只读 OAuth/PKCE、Access Token 交换、加密保存 refresh token，以及只读 Gmail API 提供器。

## Cloudflare 资源

开发用 D1 `mailhub-dev`（ID `d71b8456-203f-4da0-ad0b-5bab7e7fd915`）和 R2 bucket `mailhub-dev` 已创建，初始 D1 迁移已应用。当前收件域仍为占位域名，`workers_dev` 关闭；未配置生产域名、Access 应用或 Email Routing。Gmail OAuth 客户端密钥/加密密钥也尚未配置，Gmail 增量同步尚未实现。此状态不能用于真实邮件生产部署。

密钥请使用 Wrangler Secrets 或本地 `.dev.vars`，不得提交到 Git。生产 OAuth 至少需要 `APP_BASE_URL`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` 和 base64 编码的 32 字节 `TOKEN_ENCRYPTION_KEY`。