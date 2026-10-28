# MailHub

基于修订版实施文档 v2.0 的 Cloudflare 邮箱聚合工作台（单所有者、私有部署）。

## 本地开发

- `npm install`
- `npm run dev`
- `npm test`
- `npm run build`
- 本地 D1 迁移：`npx wrangler d1 migrations apply mailhub-dev --local`

Cloudflare D1/R2 ID、收件域、Access JWT、Gmail OAuth 等真实环境参数尚未配置。`wrangler.toml` 中数据库 ID 与域名是占位值，不可直接用于生产部署。G0 邮件路由与 Gmail 授权验证需在专用测试资源上完成。
