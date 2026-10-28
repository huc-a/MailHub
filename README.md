# MailHub

基于修订版实施文档 v2.0 的 Cloudflare 邮箱聚合工作台（单所有者、私有部署）。

## 本地开发

- `npm install`
- 配置 `.dev.vars`：仅本地可设 `APP_ENV=local` 和 `ALLOW_LOCAL_AUTH=true`；再设置 `MAIL_DOMAIN=...`。
- `npm run dev`
- `npm test`
- `npm run build`
- 本地 D1 迁移：`npx wrangler d1 migrations apply mailhub-dev --local`

私有 API 在生产环境要求 `Cf-Access-Jwt-Assertion`，并验证 Access 签名、issuer、audience 与过期时间。配置 `ACCESS_TEAM_DOMAIN` 和 `ACCESS_AUD`；本地身份模拟只在 `APP_ENV=local` 且 `ALLOW_LOCAL_AUTH=true` 时启用。不要把密钥写入仓库。

当前实现包含健康检查、Access 身份映射、临时邮箱创建/幂等键/TTL 上限、邮箱列表和 Email Routing 地址有效期拒收。Cloudflare D1/R2 仍未绑定真实资源：wrangler.toml 的 ID/名称是占位值，且当前账户尚未启用 R2。G0 的真实邮件投递与 Gmail 授权仍需测试域和 Google OAuth 客户端，暂不可生产部署。