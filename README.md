# MailHub

MailHub 是一个运行在 Cloudflare 上的个人邮箱工作台，提供统一收件箱、转发邮箱同步和临时邮箱管理。项目使用 Cloudflare Workers 运行 API，D1 保存邮件索引与配置，R2 保存邮件正文和附件。

## 功能

- **统一收件箱**：汇总邮件来源，支持搜索、未读筛选和分页。
- **转发汇总邮箱**：通过 IMAP 读取 Gmail、QQ 等邮箱中的转发邮件，并按来源文件夹归类。
- **临时邮箱**：创建 MailHub 自有地址，或创建 temp-mail.io、mail.td 随机/自定义地址；支持收件同步、验证码识别、复制地址、续期和删除。
- **邮件详情**：D1/R2 分层存储邮件信息与正文，提取验证码和邮件链接；HTML 正文经过净化并在隔离 iframe 中显示。
- **Gmail OAuth**：提供只读 OAuth/PKCE 和增量同步实现；连接前需配置自己的 Google Cloud OAuth 客户端。
- **访问保护**：生产 API 使用 Cloudflare Access 身份校验。

## 技术栈

- Vue 3、TypeScript、Vite
- Cloudflare Workers、D1、R2、Email Routing、Access
- Vitest、Wrangler

## 项目结构

```text
src/
  providers/       Gmail、IMAP、temp-mail.io 和 mail.td 适配器
  security/        Access 身份校验、加密与 HTML 净化
  ingestion/       MIME 邮件解析
  worker.ts        Worker API、定时任务和邮件路由
  App.vue          前端工作台
migrations/        D1 schema 迁移
test/              单元与 Worker API 测试
docs/              配置说明、实施文档和 UI 原型
wrangler.example.toml  Cloudflare 配置模板
```

## 本地开发

需要安装 Node.js 20 或更高版本及 npm。

```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars
Copy-Item wrangler.example.toml wrangler.toml
```

首次使用请按实际环境编辑本地 `wrangler.toml`，至少为 D1 填入数据库 ID，并确认 R2 bucket 名称。`.dev.vars` 仅用于本机开发；其中的 `ALLOW_LOCAL_AUTH=true` 允许通过本地请求头模拟用户，**不得部署到生产环境**。

```powershell
npx wrangler d1 migrations apply mailhub-dev --local
npm run dev
```

另开终端执行质量检查：

```powershell
npm test
npm run typecheck
npm run build
```

测试使用模拟数据库、邮件服务器和上游接口；测试不会验证真实 Cloudflare 账户、真实 Gmail 或第三方临时邮箱的实时可用性。

## Cloudflare 配置

`wrangler.example.toml` 不含生产域名和 Cloudflare 资源 ID。部署到自己的账户前：

1. 创建 D1 数据库和 R2 bucket，并将名称及 D1 ID 写入本机 `wrangler.toml`。
2. 配置自己的邮件域名、Worker 自定义域名和 Cloudflare Email Routing；如需将未匹配的邮件继续转发，设置 `FALLBACK_EMAIL` Secret。
3. 先建立 Cloudflare Access 应用，再配置 Worker 变量 `ACCESS_TEAM_DOMAIN` 和 `ACCESS_AUD`。确保 Access 在 Worker 对公网开放前已启用。
4. 在 `wrangler.toml` 中配置自己的 `MAIL_DOMAIN`、`APP_BASE_URL` 和 Worker route。
5. 应用数据库迁移并部署：

```powershell
npx wrangler d1 migrations apply mailhub-dev --remote
npx wrangler deploy
```

具体邮件路由流程见 [Cloudflare Email Routing 配置说明](docs/生产收件路由.md)。

## Secrets 与敏感数据

不要将密钥、`.dev.vars`、`.cloudflare.env`、本机 `wrangler.toml`、Cloudflare 本地状态或真实邮箱地址提交到 Git。生产密钥应通过 Wrangler Secrets 设置：

```powershell
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put FALLBACK_EMAIL
```

只为实际启用的功能设置对应 Secret。`TOKEN_ENCRYPTION_KEY` 必须是 32 个随机字节的 Base64，用于加密 D1 中保存的上游会话和 OAuth refresh token；丢失后，已有密文无法解密。生成命令：

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

本地密钥示例见 `.dev.vars.example`。`wrangler.toml` 和 `.dev.vars` 已在 `.gitignore` 中排除；向 GitHub 推送前仍应检查暂存区和完整提交历史。

## 已知限制

- temp-mail.io 集成调用其网页使用的非公开接口；服务端接口或可用域名变化时，适配器可能需要更新。外部邮箱和邮件由该服务接收与保留。
- mail.td 集成按其网页客户端协议派生 Argon2id 凭据并完成 PoW；Argon2id 在浏览器端计算，只有派生凭据和经 AES-GCM 加密的外部会话保存在 MailHub。第三方协议和域名可能变化，邮件由 mail.td 接收与保留。
- Gmail 同步需要你自己的 Google OAuth 配置；Gmail 附件同步尚未实现。
- 生产部署需要单独配置 Cloudflare 资源、Access、邮件路由和 Secrets；模板不会直接部署到任何账户。

## 相关文档

- [Gmail OAuth 配置](docs/Gmail%20OAuth%20配置.md)
- [转发汇总邮箱连接](docs/转发汇总邮箱连接.md)
- [Cloudflare Email Routing 配置](docs/生产收件路由.md)
- [MailHub 实施文档](docs/MailHub_修订版实施文档.md)
