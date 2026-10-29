# Gmail OAuth 配置

MailHub 已实现 Google OAuth 授权、只读 Gmail 同步、增量同步和 refresh token 加密。生产连接还需要你自己的 Google Cloud OAuth 客户端凭据；这些值不应提交到 Git，也不要发到聊天中。

## 1. 创建 Google OAuth 客户端

1. 在 [Google Cloud Console](https://console.cloud.google.com/) 创建或选择一个项目。
2. 启用 **Gmail API**。
3. 打开 **Google Auth Platform**，填写应用名称和支持邮箱。
4. 配置 Audience。个人测试可选 **External / Testing**，并把你准备连接的 Gmail 地址添加为 test user；Google Workspace 内部使用则可按组织要求配置 Internal。
5. 在 **Data Access** 添加 scope：`https://www.googleapis.com/auth/gmail.readonly`。
6. 创建 OAuth Client，应用类型选 **Web application**。
7. 在 Authorized redirect URIs 添加下面这个地址（必须完全一致）：

   `https://YOUR_DOMAIN/oauth/gmail/callback`

8. 保存并复制 Client ID 与 Client Secret。

## 2. 设置生产 Worker Secrets

在项目目录 PowerShell 中分别运行以下命令。每条命令会提示输入值；把值粘贴到提示中，不要加引号，也不要把它们写进 `wrangler.toml`。

```powershell
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY
```

`TOKEN_ENCRYPTION_KEY` 必须是 **32 个随机字节的 Base64**。生成方法：

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

请把生成值存入密码管理器或其他安全备份，再粘贴给 `wrangler secret put`。这把密钥用于加密 D1 中的 Google refresh token；丢失后，现存授权 token 将无法解密，需要删除连接并重新授权。

以上命令会更新已部署的 `mailhub` Worker Secrets。设置完成后验证名字（该命令不会显示 secret 值）：

```powershell
npx wrangler secret list
```

## 3. 连接并启动同步

1. 登录你部署的 MailHub 域名并打开 **邮箱连接**。
2. 刷新页面，确认“Google OAuth 尚未配置”提示消失。
3. 点击 **连接账号**，在 Google 页面选择账户并同意 Gmail 只读权限。
4. 返回 MailHub 后，在 Gmail 卡片点击 **立即同步**。
5. 在 **任务中心** 查看同步状态；完成后回到收件箱查看邮件。

同步只读取 Inbox，不会发送邮件或修改 Gmail 原邮件。Gmail 附件目前不从 Gmail 同步。

## 测试模式说明

External / Testing 仅允许 OAuth Audience 中列出的测试用户。Google 当前会在七天后让测试用户的授权失效，因此该模式适合先验证个人连接，不适合长期无人值守同步。Gmail `gmail.readonly` 属于 restricted scope；面向其他用户公开使用前，需要检查 Google OAuth verification 与 Gmail API 的安全评估要求。
