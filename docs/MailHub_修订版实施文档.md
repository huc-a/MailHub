# MailHub 邮箱聚合工作台｜修订版实施文档 v2.0

修订日期：2026-10-28
文档状态：建议实施基线，尚未完成真实环境验证。
适用对象：个人自用、单所有者、Cloudflare 优先部署；非公开临时邮箱服务。
依据：用户提供的《邮箱聚合工作台：从需求到上线的完整实施方案》1.md。[file:1]
交付配套：离线交互 HTML 原型、数据库基线 SQL、接口契约草案。本文件替代原稿中的阶段计划与不完整示例；不是已部署系统，也不代表完整生产代码。

## 01｜结论与修订原则

保留 Vue 3 + TypeScript + Workers + D1 + R2；保留临时邮箱入站与 Gmail API 拉取两条链路；不做发送邮件、公开注册或多租户 SaaS。Outlook 后置。修订重点不是增加功能数量，而是使每一步有依赖、有状态、有失败恢复、有可验证出口。

原稿已经覆盖产品定位、目录、基础 SQL、API、部署和测试，但不少代码明确只是骨架；原文混入 Mermaid 渲染 CSS、图片临时地址和“官方文档+1”等残留，不能直接作为工程执行稿。本稿去掉这些内容，以结构化流程和明确约定替代。[file:1]

以下数值均为本项目建议默认值，不是平台额度、已测性能或用户已确认要求；开发前可调整，但必须同步更新服务端校验、UI 提示与测试。

### 1.1 修订对照

| 原稿问题 | 修订决定 | 优先级 | 验证方式 |
| --- | --- | --- | --- |
| 私密访问有目标但无登录方案 | Cloudflare Access 单所有者白名单 + Worker 验证 JWT + 本地 users 映射 | P0 | 缺失/伪造 JWT、错误 audience 均被拒绝 |
| 临时邮箱 access token 与站点账号并存，权限含义不清 | 本期只用站点身份授权，不生成独立邮箱访问 token；不做匿名分享 | P0 | 仅地址不能读取；所有查询带 owner 条件 |
| 可行性验证靠后 | UI 精修前先完成 catch-all、真实邮件、MIME、Gmail 授权尖峰验证 | P0 | 测试域真实邮件可入站，自己的 Gmail 可授权 |
| 入站和拉取被同一个 sync() 勉强统一 | 统一邮件模型，不强求统一接入动作；分 InboundReceiver 与 PullSyncProvider | P0 | 临时邮箱不存在伪远程同步 |
| 同步只有 cursor 字段 | 增加初始同步边界、historyId、分页检查点、账号租约、重试和 404 恢复 | P0 | 故障重跑不漏数据、不重复、游标不越过未提交批次 |
| 日清理与“到期不可读”容易混淆 | 每个读取/下载/接收入口即时判断 expires_at；任务负责物理清理 | P0 | 清理任务停机时，过期邮箱仍不可读 |
| D1/R2 无共同事务 | D1 durable job + ingestion 状态 + 对象清单 + 补偿与巡检 | P0 | 注入 R2/D1 故障后可重试恢复 |
| 已读/删除会不会修改 Gmail 不明确 | 本期已读仅 MailHub 本地；断开/清理不删除 Gmail 原邮件 | P0 | UI 明示范围，API 无 Gmail 写权限 |
| 搜索和 HTML 缺少边界 | 仅主题/发件人元数据搜索；HTML 净化 + iframe + CSP，默认无网络资源 | P0 | XSS、CSS 资源请求、跟踪像素测试 |
| 验收用“能正常工作”描述 | 改为 Given/When/Then 与故障注入清单 | P0 | 每里程碑附验证记录 |
| 缺少环境隔离/恢复 | dev/staging/prod 独立资源，先迁移后启用新代码，备份恢复演练 | P0 | staging 恢复与回滚演练 |
| 未设容量与成本阈值 | 设邮箱/邮件/附件/任务上限、用量告警和限额行为 | P1 | 达阈值返回明确状态、不无限增长 |

优先级说明：P0 为真实上线前必须完成；P1 为受控个人使用稳定后补齐；P2 为未来扩展。

## 02｜产品范围与不做清单

### 2.1 本期完成

1. 单所有者登录与退出、受保护的 UI/API/附件。
2. 临时邮箱随机地址、创建/复制/续期/删除、过期拒收与不可读、自动清理。
3. 统一收件箱：来源/邮箱/未读过滤、元数据搜索、游标分页、邮件详情。
4. MIME 正文解析、验证码候选、纯文本优先、受限 HTML 预览、授权附件下载。
5. Gmail 只读授权、最近窗口首次同步、增量同步、手动触发、失败恢复、断开并清理本地数据。
6. 设置、连接状态、任务状态、脱敏诊断、生产部署与恢复说明。

### 2.2 明确不做

不发邮件、不回复、不提供 SMTP/IMAP 服务、不采集邮箱密码、不注册多个用户、不提供匿名邮箱读取链接、不做全文搜索、不做附件在线预览/执行、不接 AI 服务、不保证临时地址被所有网站接受。临时邮箱不可用于重要账号的唯一找回渠道。

Gmail 仅同步 Inbox 范围、默认最近 7 天最多 200 封首次邮件；不读取 Spam/Trash；后续增量处理窗口内的新增、移出 Inbox、标签变化和服务商删除。更改范围需要显式重建本地缓存，不暗中扩大读取。gmail.readonly 的实际授权范围大于这一本地筛选范围，授权页和隐私说明必须如实说明。[web:18]

### 2.3 默认参数（设计值，待确认）

| 项目 | 默认 | 可调边界/说明 |
| --- | --- | --- |
| 临时邮箱有效期 | 60 分钟 | 10/30/60/1440 分钟 |
| 续期 | 活跃期内延长 60 分钟 | 总到期时间不超过创建后 24 小时；过期不可复活 |
| 活跃临时邮箱 | 10 个 | 达上限返回 MAILBOX_LIMIT_REACHED |
| Gmail 账号数 | 1 个 | 后续可扩至多个独立任务 |
| 本地邮件列表 | 每页 30 条 | 最大 100 |
| 前台列表刷新 | 20 秒 | 15/20/30/60 秒；后台暂停 |
| Gmail 定时同步 | 5 分钟 | 仅处理到期任务；不承诺实时 |
| 手动同步冷却 | 每账号 60 秒 | 已运行时返回同一活动任务 |
| 首次 Gmail 同步 | 最近 7 天、最多 200 封 | UI 明示，不冒充完整历史 |
| Gmail 本地保留 | 30 天 | 指 received_at 起算的缓存保留；原邮箱不受影响 |
| 临时邮箱物理清理 | 到期/删除后目标 24 小时内 | 逻辑禁读立即执行；SLO 不含历史备份 |
| 入站原始 MIME 应用上限 | 5 MiB | 保守工程限制，不等同平台 25 MiB 入站上限 |
| 附件 | 单个 2 MiB、合计 3 MiB、最多 10 个 | 超限保留说明，不提供文件下载 |
| 单封正文 | 解码文本/HTML 合计 512 KiB | 超限截断并给出标记 |
| 原始 MIME 保留 | 默认关闭 | 仅脱敏诊断时临时开启，有独立 TTL |

Cloudflare 当前文档列出 Email Routing 入站上限 25 MiB、每域 200 条规则，且入站 Worker 受计划的 CPU/内存限制。因此上述更小的应用上限仍必须通过真实 MIME 样本和运行预算验证，不能由平台上限推断解析一定成功。[web:19]

## 03｜先验证，再投入：阶段门 G0

以下验证全部使用测试域、测试账号和无敏感内容样本。

| 验证项 | 操作 | 通过标准 | 不通过处理 |
| --- | --- | --- | --- |
| 动态地址路由 | 专用收件子域，catch-all 指向 email Worker | 两个不同随机 local-part 都进入同一 Worker | 暂停临时邮箱开发，先修域名/MX/路由 |
| 有效地址校验 | D1 仅登记其中一个地址 | 登记地址接收；未知/过期地址 setReject | 不允许 catch-all 等于全开放邮箱 |
| MIME 预算 | 文本/HTML/中文/附件/畸形/5 MiB 边界样本 | 当前计划无超预算，失败有可诊断状态 | 降上限、切换付费计划或评估异步解析 |
| Gmail 授权 | Web OAuth 客户端 + 测试用户 + readonly | 服务端获 token，可读一封测试邮件 | 检查回调/scopes/项目配置 |
| 授权生命周期 | 记录 External/Testing 与重授权流程 | 7 天规则与重新连接 UI 均明确 | 不能把 Testing 当长期稳定生产方案 |
| 资产与 API | 访问 /api/v1/me、未知 API 和 SPA 深链接 | API 始终 JSON，SPA 深链接可恢复 | 修正 Worker-first 与 fallback |
| 登录边界 | 自定义域及默认 workers.dev/预览入口 | 无绕过 Access 的可用业务入口 | 禁用入口或同等保护并验证 JWT |

Cloudflare 官方明确支持 catch-all 将域名内未单独匹配的地址交给一个目标，目标可为 Worker；本期不逐个随机地址创建路由规则，地址合法性由 D1 决定。catch-all 的存在已经有官方依据，但你实际账号、子域和 DNS 配置仍需实测。[web:2][web:4]

## 04｜目标架构与职责

```text
浏览器 Vue 3
  └─ Access 单所有者登录 → Worker fetch API → D1 元数据 / R2 私有正文附件
外部邮件 → 专用域 MX → catch-all → Worker email → 受限解析 → 入库流程
Cron → D1 持久任务调度 → Gmail PullSyncProvider → 同一入库流程
Cron → 清理/重试/对账 → D1 任务、对象清单、R2 删除
```

本期保留一个 Worker 的 fetch/email/scheduled 三种入口，业务按模块解耦；预算不够再拆 Worker。无需为了统一前端把推送入站伪装成拉取同步。

```ts
interface InboundReceiver {
  receive(input: InboundEnvelope): Promise<IngestResult>;
}
interface PullSyncProvider {
  bootstrap(ctx: SyncContext): Promise<SyncPage>;
  incremental(ctx: SyncContext): Promise<SyncPage>;
  fetchMessage(id: string, ctx: SyncContext): Promise<NormalizedEmail>;
  revoke(ctx: AccountContext): Promise<void>;
}
interface MailRepository {
  ingest(email: NormalizedEmail, key: DedupKey): Promise<IngestResult>;
  list(owner: OwnerId, filter: InboxFilter): Promise<CursorPage<EmailSummary>>;
}
```

所有来源统一 NormalizedEmail、EmailSummary 和列表 API，不统一不相同的业务动作。Outlook 作为 P2 新增 PullSyncProvider，而非先放假实现。

### 4.1 不加队列，不等于没有可靠任务

MVP 使用 D1 jobs 表承载持久重试、清理和同步；Cron 调度，不把 ctx.waitUntil 当可靠队列。HTTP 手动同步先落 jobs，再返回 202；可以在本次执行中机会性启动任务，但终止后由调度恢复。记录 attempt、lease、available_at 和幂等键。

触发任一条件重新评估 Queues/独立处理 Worker：频繁超 CPU/内存、任务积压持续超过两轮同步周期、需要把超大 MIME 原文先持久化再异步解析、账号并发明显增加。引入 Queues 也仍需幂等和死信策略，不承诺 exactly-once。

## 05｜身份、授权与隐私

### 5.1 两种授权必须分开

站点登录回答“谁能打开 MailHub”；Gmail OAuth 回答“MailHub 能读取哪个 Google 邮箱”。Gmail 连接不能代替站点登录。users 使用 Access issuer+subject 唯一映射，不由浏览器传 user_id。白名单只允许所有者。

Worker 使用经过验证的 Cf-Access-Jwt-Assertion；校验签名、issuer、audience、exp，并缓存/轮换 JWKS。不信任裸 email 头，也不只判断请求是否带 JWT。Cloudflare 官方指出，即使 Access 在 Worker 前，也需要 Worker 验证该 JWT。[web:20]

默认 workers.dev 和预览 URL 禁用，或做等价保护；开发模式模拟身份只能显式在 local 环境启用，staging/prod 缺失认证配置直接失败关闭。email 和 scheduled 入口不使用浏览器登录，分别依赖入站合法地址和内部调度权限，不开放 HTTP 免鉴权触发口。

### 5.2 API 权限规则

每次读取邮件、正文、附件、任务都使用当前用户归属过滤；不存在和他人资源统一 404，避免枚举。创建邮箱无需向前端发送独立访问 token。临时邮箱地址不是秘密，但其邮件内容是私有数据。

对所有写接口要求同源 Origin、JSON Content-Type 和 CSRF 保护；不开放通配 CORS。附件和正文响应 Cache-Control: private, no-store；应用日志禁止正文、主题中的验证码、授权 code、token、完整地址。OAuth 回调 query 与请求体日志要专门关闭/脱敏。

### 5.3 Token 加密

使用经审查的 OAuth 与 JWT 库，验证 Workers 兼容性。refresh token 服务端 AES-GCM 加密保存，随机 nonce；AAD 绑定 user_id/account_id/provider；保存 key_version，密钥放 Secrets。轮换时旧密钥只解密、新密钥写入，分批重加密完成后再移除旧版本；密钥备份与数据备份分离。二次授权没有返回 refresh token 时，不能用 null 覆盖已有有效 token。

令牌加密不等于邮件正文端到端加密。邮件正文会在服务端可解密/可处理，必须在隐私说明中明确；如需正文应用层加密，应另建密钥、搜索与恢复方案。

## 06｜核心状态机

| 资源 | 状态 | 转换/规则 |
| --- | --- | --- |
| 临时邮箱 | active → expired 或 deleting → deleted | 请求时先算 expires_at；expired 不可续期 |
| Gmail 账号 | authorizing → connected → syncing → connected | 失败进入 backoff 或 reauth_required |
| Gmail 断开 | disconnecting → disconnected | 停调度、废弃 worker lease、撤销、清凭证与本地数据 |
| 邮件入库 | staged → ready / failed → deleting | 只有 ready 可在列表出现 |
| 任务 | pending → running → succeeded / retry_wait / dead | 运行租约到期可接管，dead 需手动重试 |
| 数据清理 | requested → deleting_objects → deleting_metadata → completed | 先禁读，清单保留至对象删除完成 |

不可用一个笼统 status 同时表达账号是否授权、任务是否运行、邮箱是否过期。账号 auth_status、sync_status 和 task.status 分开返回。

## 07｜临时邮箱完整流程

### 7.1 创建与续期

1. 认证、配额、参数校验；使用密码学随机 local-part，建议 16 个小写字母数字字符。
2. 用全小写自有域名保存地址；UNIQUE 冲突重新生成。禁止复用已删除地址，避免旧邮件误投给新邮箱。
3. 保存 user_id、created_at、expires_at、状态。POST 带 Idempotency-Key，同键同请求返回同一邮箱；同键不同请求返回 409。
4. 前端展示完整地址、复制按钮、绝对到期时间及剩余时间；以服务端 serverTime 修正倒计时。
5. 续期使用服务端时间与条件更新：仅 active 且尚未到期，更新不得超过 created_at+24h；到上限禁用。

### 7.2 接收与持久化

1. 依据 SMTP envelope 收件地址 message.to，不以邮件正文 To 头进行授权路由；域名严格匹配。
2. D1 查询活跃邮箱并检查 expires_at，未知/删除/到期地址明确拒收。
3. 检查 rawSize 等预算；先读受限数据再解析；原始编码与解码后大小分别限额，避免 MIME 膨胀。
4. 计算幂等键：临时邮箱 ID + 原始 MIME SHA-256；Message-ID 仅辅助记录，不单独作为唯一身份。此规则会把同邮箱完全相同字节的再次投递合并，这是已接受的 MVP 取舍。
5. 原子登记 staged 邮件与预期对象清单；若已 ready 则直接确认，staged 则检查租约并继续恢复，不并发重写。
6. 写 R2 确定性对象路径，记录 size/checksum/状态；所有必需对象成功后用 D1 batch 提交元数据、附件索引及 ready 状态。
7. ready 提交前重新检查邮箱仍活跃、未到期、generation 未改变，避免入站与删除竞态；失败转清理。
8. 接收不能在持久化完成前无条件确认成功。未知地址明确拒收；存储/运行时错误的投递重试行为必须在 G0 实测，不假设一定重试。只有成功保存到可恢复介质后才可把后续解析交给后台。

MIME 解析评估 postal-mime 等 Workers 兼容库；固定版本，用真实样本测内存/CPU。HTML、字符编码、折行邮件头、multipart/alternative、CID、内嵌图片、空主题、畸形 MIME 均需覆盖。超限附件保留元信息与 skipped_reason，不生成有效下载链接。

## 08｜Gmail 授权与同步

### 8.1 OAuth

使用 Web application 客户端，服务端 Authorization Code 流程；access_type=offline，state 高熵、散列存储、绑定当前 user 与浏览器会话、10 分钟过期、一次性原子消费。启用所用 OAuth 实现支持的 PKCE S256，并以真实 Google 客户端验证；不把未测试的 PKCE 兼容性当既成事实。回调严格固定 redirect_uri，禁止用户传入任意跳转目标。

回调错误、拒绝授权、过期 state、重放、站点身份变化、缺少所需 scope、令牌交换失败均有明确错误页面，不留下 authorizing 假连接。成功后 303 跳转到无 code/state 的账号页，避免地址栏残留。

请求 gmail.readonly，不请求发送与修改权限。它仍是 Restricted scope；公开发布、服务端存储受限数据时要单独评估验证、安全评估及适用豁免，个人自用不能被直接推广为“公开使用无需审核”。External + Testing 请求邮件范围时 refresh token 7 天到期，原稿的测试模式方案只能用于开发验证。[web:17][web:18]

### 8.2 初次同步与一致性

1. 在账号租约内启动 bootstrap，记录同步范围、开始时间、baseline historyId。
2. 按 Inbox + 最近 7 天列 IDs，最多 200 封；保存 pageToken 和已完成计数，分批取详情，按 provider account+message ID 幂等入库。
3. 列表不是事务快照，因此完成初次分页后，从 baseline historyId 回放历史变更，补齐同步期间到达、删除或移出 Inbox 的邮件。
4. Gmail history 可能包含重复消息事件；按 message ID 拉取当前状态并 upsert，按本地镜像范围判断保留/移除。不能只处理 messagesAdded 而忽略删除和标签变化。
5. 所有页均提交后更新 committed historyId；中途失败保留旧 committed cursor，检查点只表示进度，不表示完整成功。
6. 若范围内邮件超过上限，UI 显示“仅最近窗口/已达首次同步上限”，不显示“全部历史已同步”。

### 8.3 增量与恢复

调用 history.list(startHistoryId=committed)，逐页处理变更；有 nextPageToken 继续，无下一页且处理完毕才提交新的 historyId。historyId 保存为字符串，不按 JS number 计算或自增。Google 说明历史 ID 不连续，超出保留区间会返回 404，必须重新完整同步；本项目的完整同步指“重新构建选定 Inbox/时间窗口”，不是偷偷下载全部历史。[web:5][web:7]

恢复重建采用新 sync_generation，扫描结束后只清理旧 generation 且确认不属于当前范围的本地缓存；不要在失败中途清空所有旧邮件。Gmail 远端已读状态和 MailHub 本地已读分开记录；默认 UI 的未读筛选基于 MailHub 本地状态，不回写 Gmail。

### 8.4 并发、退避和断开

每账号单租约，使用条件 UPDATE ... RETURNING 原子认领；租约 token/版本作为 fencing token，心跳续约，提交时校验 token 与 account generation，防止过期任务继续提交。建议单批 20 封、详情并发 2、每次执行保留足够余量后续跑，实际按计划预算测定。

429/临时 5xx：尊重 Retry-After，指数退避+jitter，最多 5 次；令牌过期刷新一次；invalid_grant/用户撤销进入 reauth_required 并停止自动重试；配置/权限错误进入 blocked。401 不能直接无限循环。手动与 Cron 同时触发只得到一个活动 job。

断开时立即 auth_status=disconnecting、generation+1 并禁用访问与调度；独立任务尝试撤销远程授权、清本地 token 和所有缓存。撤销失败不影响立即停用，但需单独的撤销待办保留短期加密凭证，按 TTL 重试，完成后销毁。超时则提示用户在 Google 账户安全页手动撤销，不假报已撤销成功。

## 09｜数据库与对象设计

统一时间：数据库所有时间为 UTC epoch 毫秒 INTEGER；API 用 ISO-8601 Z；前端本地化显示并提供绝对时间。禁止混用 datetime('now') 空格格式和 ISO 字符串做比较。

配套 schema.sql 为新项目基线，不是从旧数据库无损升级脚本，未在 Cloudflare D1 实际执行；已做本地 SQLite 语法和基础约束检查。已有数据必须另写迁移、备份与回填脚本，不可直接覆盖。[file:1]

### 9.1 表职责

| 表 | 核心内容 |
| --- | --- |
| users | issuer+subject、所有者身份 |
| mailboxes | 临时邮箱、有效期、删除 generation |
| provider_accounts | 连接身份、加密 token/key_version、授权状态、committed cursor、租约 |
| emails | 所有者、来源二选一、provider ID、入库状态、本地/远端已读、接收时间 |
| mail_objects | 每封邮件对象清单、用途、字节、校验、上传状态；删除完成前保留 |
| email_attachments | 文件元数据、允许下载与跳过原因 |
| jobs | 持久任务、尝试次数、可运行时间、租约、去重键、脱敏错误 |
| oauth_states | 散列 state、会话绑定、过期/消费时间 |
| idempotency_keys | 请求哈希与资源结果、有效期 |
| app_settings | 版本化设置 JSON |

复合外键 (mailbox_id,user_id)/(provider_account_id,user_id) 强制来源归属同一用户；仅在 emails.user_id 写外键而不绑定来源，仍可能出现跨所有者错挂。API 授权不可被外键替代。来源二选一 CHECK 与 source 类型一致性 CHECK 同时存在。

### 9.2 一致性协议

先在 D1 登记 staged 与对象清单，再写 R2，最后转 ready；ready 前不可见。R2 与 D1 不构成共同事务，恢复靠同幂等键、确定对象名、持久任务和巡检。上传前登记对象，即使上传后 D1 更新失败，也可按清单重试 HEAD/GET 核验，不必全桶扫描找孤儿。

对象键使用随机内部 ID，不含主题或邮箱地址，例如 u/{userId}/e/{emailId}/{objectId}。Content-Type 由服务端允许列表决定；原文件名只用于显示/安全 Content-Disposition，不拼接对象路径。

索引优先：(user_id,received_at_ms DESC,id DESC)、来源+时间、jobs(status,available_at_ms)。元数据搜索先限制窗口并做参数化查询；不宣称 LIKE '%q%' 可凭普通索引高效全文检索。量上来再做独立 FTS 设计。

## 10｜到期、删除与恢复

### 10.1 逻辑删除立即生效

每个邮件列表、详情、HTML、附件下载以及入站完成提交，都校验其父资源仍可用；不能只在 mailbox GET 判断过期。即使 Cron 停机一天，过期邮箱也不可读和接收。邮箱到期不允许续期，地址保留 tombstone 永不分配给他人。

### 10.2 可靠物理清理

1. DELETE 在一个 D1 batch 中将父资源 deleting、generation+1、插入 cleanup job；返回 202+jobId。
2. UI 立即移出可用邮箱，任务页显示“清理中”；重复删除返回已有任务。
3. 按 mail_objects 分页删除 R2，对不存在对象视为成功，记录批次进度。
4. 全部对象删除成功后才删附件索引/邮件记录，最后邮箱 tombstone=deleted。
5. 某对象删除失败进入 retry_wait，不提前丢掉对象清单。
6. 每 5 分钟处理到期邮箱与到期缓存，夜间做失败/孤儿对账。清理目标 24 小时是拟定 SLO，必须监控积压并告警。

恢复备份不得让已删除邮箱再次可读。备份单独声明保留期、访问控制、销毁方式；恢复流程重放删除清单、重新执行过期判断。正式说明只能承诺在线主存储清理目标，不能笼统承诺“所有历史备份立即抹除”。

## 11｜API 契约与错误模型

所有业务接口 /api/v1，JSON；正文预览和附件流为明确例外。未定义 /api/* 永远返回 JSON 404，不允许回落 SPA HTML。UI 不以 HTTP 200 作为“同步完成”，而看任务状态。

| 方法 | 路径 | 成功 | 说明 |
| --- | --- | --- | --- |
| GET | /me | 200 | 当前所有者、环境、serverTime |
| GET/POST | /mailboxes | 200/201 | 创建带 Idempotency-Key |
| POST | /mailboxes/{id}/renew | 200 | 服务端 TTL/期限校验 |
| DELETE | /mailboxes/{id} | 202 | 逻辑禁读并生成清理任务 |
| GET | /emails | 200 | 元数据、游标、来源/账号/邮箱筛选 |
| GET | /emails/{id} | 200 | 不自动改变已读 |
| PATCH | /emails/{id} | 200 | 仅 localIsRead 布尔值 |
| GET | /emails/{id}/html | 200 text/html | 净化后、CSP、no-store |
| GET | /emails/{id}/attachments/{attachmentId} | 200 流 | 双重归属和过期检查 |
| GET | /accounts | 200 | 授权状态、同步时间、窗口 |
| POST | /accounts/gmail/connect | 200 | CSRF 校验后返回授权 URL，不由 GET 静默写 state |
| GET | /oauth/gmail/callback | 303 | state 一次性消费，跳转账号页 |
| POST | /accounts/{id}/sync | 202 | 已有任务返回同 jobId |
| DELETE | /accounts/{id} | 202 | 断开+本地清理，不删远端邮件 |
| GET | /jobs、/jobs/{id} | 200 | 仅本人脱敏任务 |
| POST | /jobs/{id}/retry | 202 | 仅可重试类型，校验幂等 |
| GET/PATCH | /settings | 200 | 设置版本防覆盖 |

原稿 POST /emails/refresh 含义混合，本稿移除：列表刷新就是 GET /emails；远程同步是 POST /accounts/{id}/sync。纯刷新不应创建远程任务。[file:1]

列表排序 received_at_ms DESC,id DESC；游标包含时间、ID、过滤条件摘要，服务端验证结构/范围与过滤一致性；limit 默认30最大100。返回 items、nextCursor、serverTime。新邮件到达时显示“有新邮件，更新列表”，不打乱用户正在阅读的旧页。

```json
{"error":{"code":"MAILBOX_EXPIRED","message":"临时邮箱已到期，无法继续读取","retryable":false,"requestId":"req_demo"}}
```

状态码：400 参数或游标错误；401 未登录；403 已认证但不允许操作；404 不存在/非本人；409 状态冲突/幂等键冲突；410 本人邮箱已到期；413 超应用大小；429 冷却/配额；503 暂时不可用。对第三方资源不要泄露 410 与存在性区别。

重要业务错误：AUTH_REQUIRED、MAILBOX_EXPIRED、MAILBOX_LIMIT_REACHED、REAUTH_REQUIRED、SYNC_COOLDOWN、TASK_ALREADY_RUNNING、OBJECT_NOT_READY、ATTACHMENT_SKIPPED、STORAGE_UNAVAILABLE。错误正文不得含 SQL、secret、上游 token 或完整异常堆栈。

## 12｜正文安全、附件与验证码

### 12.1 HTML 不是加一个 iframe 就安全

默认纯文本。HTML 必须使用维护中的白名单净化器并实测 Workers 兼容性；禁止直接 v-html 原始邮件、禁止正则当通用 HTML 净化器。

净化移除 script/event handler、form、iframe、object/embed、SVG/MathML、meta refresh、base、危险协议和任意远端资源；CSS 中的 url()/@import/远程字体同样处理。仅保留受控排版样式，默认拒绝图片和 CID 资源（P1 可增加授权 CID 图片映射）。

隔离页面用 sandbox 空值 iframe，不授予 allow-scripts/allow-same-origin/allow-top-navigation/allow-forms；referrerpolicy=no-referrer。独立预览响应使用 CSP：default-src 'none'; script-src 'none'; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; sandbox。净化器移除所有链接 href，安全外链在父应用另行显示并经过确认，仅允许 http/https，noopener/noreferrer。

sandbox 并不自动阻止所有网络加载；净化和 CSP 必须共同验证。MDN 特别警告同源内容同时允许 scripts 与 same-origin 会削弱沙箱隔离。[web:22]

### 12.2 附件

R2 私有，仅 Worker 授权代理流式下载；Content-Disposition: attachment；X-Content-Type-Options: nosniff；不直接预览 HTML/SVG/可执行文件。展示“未做病毒扫描，请谨慎打开”，不能显示虚假的安全扫描通过。文件名规范化、禁止 CRLF、剔除路径片段，限制长度。超限/跳过附件只能看到原因，不出现可点击下载。

### 12.3 验证码

独立规则服务输出 candidates[{value,confidence,matchedKeyword,sourceOffset}]，优先主题/纯文本语义邻近“验证码/verification code/OTP”，识别常见4–8位数字/字母数字，排除金额/日期/订单号。高置信才显示主卡；多候选显示“可能的验证码”，无结果回到正文手工复制。

不通过规则凭空推断真实失效时间。若邮件明确写“10分钟有效”且时间可解析，可标记“依据邮件内容估算”；其他情况显示“以原邮件为准”，而不是假倒计时。列表不暴露明文验证码，详情默认遮挡，用户主动显示/复制；复制动作不进入日志或遥测。设置中的脱敏只改变显示，不代表数据库已加密。

## 13｜UI 信息架构与交互规范

### 13.1 五个主入口

1. 统一收件箱：左导航 / 中间邮件列表 / 右详情；来源标签清晰，顶部区分刷新列表和立即同步。
2. 临时邮箱：地址、状态、绝对到期/倒计时；创建、复制、续期、删除；无效动作禁用并说明。
3. 邮箱连接：Gmail 权限说明、同步范围、上次成功、下次计划、授权失效与断开。
4. 任务中心：同步/清理任务、状态、尝试、脱敏错误、重试；不增加独立监控平台。
5. 设置：默认 TTL、列表刷新、保留期、验证码遮挡、主题；危险操作单独区域。

邮件详情作为收件箱右侧面板；实际 Vue 项目提供 /mail/:id 深链接。原型是单 HTML 的视图切换，不实现服务端深链接。

### 13.2 视觉方案

桌面为深蓝导航 + 暖灰画布 + 白色内容，青绿色主操作；警告用琥珀色、错误用红色，不能仅凭颜色区分状态。默认无营销大横幅，优先读信效率。圆角12–16px、8px间距系统、正文14–16px、最小可点击目标44px。

宽度≥1280px显示三栏；768–1279px缩小导航与列表；<768px改为顶部/水平导航、列表与详情切换。长地址和标题允许断行，不产生页面级横向溢出。键盘可聚焦按钮，焦点样式明显，modal 使用原生 dialog 并支持 Escape。

### 13.3 必须设计的状态

Loading skeleton、空邮箱、搜索无结果、离线/请求失败、分页末尾、同步排队/执行/失败、授权过期、邮箱到期、清理中/失败、附件跳过、正文截断。自动刷新失败不清空已有列表；切账号取消旧请求，防止慢请求覆盖新视图。

## 14｜可点击原型说明与演示脚本

配套 HTML 可离线打开，不依赖 CDN 或第三方字体，全部邮箱/邮件/验证码均为模拟数据，不发真实邮件、不读取真实账号。浏览器 localStorage 仅存演示状态；生产系统严禁照搬这种凭证/邮件存储方式。

已设计交互：五页切换、元数据搜索、来源/未读筛选、邮件详情、本地已读切换、验证码遮挡/显示/复制、纯文本/隔离 HTML 切换、示例附件下载、临时邮箱创建/复制/续期/删除、模拟新邮件、模拟同步成功/失败/重新授权、任务重试、设置保存与深浅主题、重置演示。

演示步骤：
1. 收件箱打开一封验证码邮件，显示后复制；切换 HTML 查看隔离排版。
2. 创建10分钟临时邮箱，复制地址，点击模拟来信后回到收件箱查看。
3. 点击刷新列表观察其不产生同步任务，再点击立即同步观察任务状态。
4. 账号页模拟同步失败，任务中心重试；模拟授权失效后再连接。
5. 删除临时邮箱，确认弹窗说明影响范围，任务中心观察清理；本操作仅修改本地模拟状态。
6. 设置切换主题/验证码默认遮挡，保存后重新打开验证演示状态保留。

原型不等于 Vue 源码，不含真实 OAuth、API、DNS、D1、R2、病毒扫描、完整分页和后台调度；真实 TTL/清理、权限和竞态必须在后端重做。模拟任务使用浏览器计时器，关闭页面不保证继续执行。尚未做跨浏览器视觉和自动化交互验收。

## 15｜工程结构与实施顺序

```text
mailhub/
  src/client/       pages, components, composables, stores, api, types
  src/server/
    entry.ts       fetch / email / scheduled
    auth/          access-jwt, ownership, csrf
    routes/        mailboxes, emails, accounts, jobs, settings, oauth
    ingestion/     receive, mime, normalize, dedup, persist
    providers/     gmail, pull-provider-types
    sync/          bootstrap, history, lease, retry
    storage/       d1-repository, r2-objects, cleanup
    security/      html-sanitize, token-encryption, limits
  migrations/
  contracts/       openapi.yaml
  tests/           unit, worker-integration, e2e, fixtures
  docs/            runbook, threat-model, retention
```

不要沿用单个万能 mail-service 堆积全部逻辑。前后端共享 DTO 和校验 schema，但不把后端 secret 类型打包进客户端。

### 15.1 按依赖推进的里程碑

下表为工作量估算，不是固定交付日期。假定1名熟悉 Vue/TypeScript 的开发者，1人日约6小时有效开发，不含 Google 审核等待、域名等待或复杂故障排查；总计约24–37人日，缺乏相关经验需追加学习缓冲。

| 阶段 | 人日 | 输入/依赖 | 交付 | 阶段退出标准 |
| --- | --- | --- | --- | --- |
| M0 可行性与威胁建模 | 2–3 | 测试域/账号 | G0验证记录、资源预算、权限矩阵 | 双接入小样本成功，无入口绕过 |
| M1 工程与契约 | 2–3 | M0 | Vue骨架、DTO/OpenAPI、环境隔离、CI | typecheck/test/build通过 |
| M2 身份与数据底座 | 3–4 | M1 | JWT验证、D1迁移、R2私有、job/lease | 越权与基本补偿测试通过 |
| M3 临时邮箱垂直切片 | 4–6 | M2 | 创建→真实入站→解析→列表→详情 | 接收/到期/故障重试完整通过 |
| M4 阅读与前端状态 | 3–5 | M3 | 受限HTML、验证码、附件、空错态 | XSS和下载越权阻断 |
| M5 Gmail全链路 | 5–8 | M2/M4 | OAuth、bootstrap、history、撤销 | 404重建、并发、失效授权可恢复 |
| M6 清理/运维/上线 | 5–8 | M3/M5 | 可靠清理、告警、恢复、生产部署 | E2E、故障注入、恢复演练通过 |

原型可在 M0/M1 并行确认，但 UI 精修不能阻塞路由和邮件接收验证。安全从 M0/M2 开始，不再等原稿“第六阶段”才补。[file:1]

### 15.2 第一个可执行任务批次

- T001：确认域名、所有者身份、预算/计划；建立决策记录。
- T002：部署最小 email handler + catch-all，外部投递两个随机地址。
- T003：Gmail OAuth 测试用户只读取一封测试邮件，记录令牌生命周期。
- T004：初始化单仓库、版本锁定、环境与CI；提交契约草案。
- T005：Access 验证、users 映射、所有API归属过滤。
- T006：D1基线迁移、R2私有对象、持久任务与存储故障测试。
- T007：实现临时邮箱创建及幂等键，接通原型布局至真实API。
- T008：实现 MIME 限额、分阶段入库、验证码规则与基础详情。
- T009：实现到期禁读与清理任务，模拟并发入站/删除。
- T010：完成真实邮件垂直切片演示，再继续 Gmail 完整增量。

## 16｜测试计划与可测验收

测试分业务单元、Cloudflare Worker集成、Playwright前端E2E、staging真实投递四层。真实服务商测试使用专用账号，禁止上传真实邮件进公开CI fixtures。

| 编号 | 场景（Given / When） | Then 验收结果 |
| --- | --- | --- |
| AT01 | 无 JWT/伪造 email头访问 API | 无资源内容返回，不能创建邮箱 |
| AT02 | A身份访问B邮件/附件/任务 | 统一404，日志不泄露资源细节 |
| AT03 | 同幂等键重复创建10次 | 只有一个临时邮箱；不同payload同键409 |
| AT04 | 同一MIME事件重复投递10次 | 同邮箱仅一封ready邮件、无重复对象 |
| AT05 | 邮箱已到期但清理Cron暂停 | 列表/详情/HTML/附件均禁读，入站拒收 |
| AT06 | R2写完后D1提交失败 | 邮件非ready；重试恢复或清理，无永久泄漏 |
| AT07 | 删除与入站/同步同时发生 | generation阻止旧任务提交，用户立即不可读 |
| AT08 | 同账号Cron和手动同时触发 | 一个活动job/lease，UI返回同一任务 |
| AT09 | history分页中断与重跑 | committed cursor不提前推进，邮件不重复 |
| AT10 | history API返回404 | 受限窗口重建，不无限重试旧cursor |
| AT11 | 初次同步期间收到/移走邮件 | history回放后镜像范围一致 |
| AT12 | OAuth state错误/过期/重放 | 不交换/保存非法授权，返回安全错误 |
| AT13 | invalid_grant/撤销 | 显示需重授权，停止后台循环 |
| AT14 | 429/5xx/冷却 | 退避+有限重试，不请求风暴 |
| AT15 | HTML含脚本、表单、像素、CSS url | 不执行、不导航、不自动请求远程资源 |
| AT16 | 附件名含路径/CRLF、超限附件 | 无响应头注入/路径穿越；超限不可下载 |
| AT17 | 多个数字/金额/订单号 | 不确定不输出高置信验证码 |
| AT18 | 切邮箱后旧请求更晚返回 | 不覆盖当前邮箱视图 |
| AT19 | 默认入口/预览域/SPA fallback | 无认证绕过，未知API返回JSON404 |
| AT20 | 从备份恢复含已删邮箱 | 重放删除/过期规则，不恢复可读权限 |

建议性能目标（待压测）：列表API仅元数据，30条下p95≤800ms（不含终端网络）；UI本地切换≤200ms；临时邮件在已成功进入Worker后60秒内可见；Gmail可见性为调度间隔+同步耗时，不以20秒列表刷新冒充20秒远端同步。达不到即记录实测数值与瓶颈，不把目标写成已完成事实。

Definition of Done：代码审查、类型检查、相关测试、错误与脱敏日志、状态页/空错态、文档和迁移齐全；无已知P0安全缺陷。关键纯逻辑模块目标分支覆盖≥80%，但安全/竞态场景必须逐项验证，不能只看覆盖率。

## 17｜构建、Cloudflare配置与CI/CD

使用当前 Vue + Cloudflare Vite 模板建立项目，提交 package-lock，固定 Node LTS/包管理器版本。模板生成配置优先，不能机械覆盖 assets.directory；项目 build 产物必须与部署绑定一致。

```jsonc
{
  "assets": {
    "binding": "ASSETS",
    "directory": "./dist/client",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "triggers": { "crons": ["*/5 * * * *", "17 3 * * *"] }
}
```

以上仅配置片段，非可直接部署的完整 wrangler 文件；若需在 Worker 内保护所有静态资源，run_worker_first 设true。/api/* Worker-first 防止 OAuth回调/API被SPA fallback吞掉。Cloudflare 官方提供 run_worker_first 控制 Worker 与资产路由顺序。[web:21]

dev/staging/prod 独立 D1、R2、Secrets、OAuth客户端或至少回调配置；生产环境禁止指向测试资源。环境配置包括 APP_BASE_URL、ACCESS_TEAM_DOMAIN、ACCESS_AUD、收件域名、限额；Secrets 包括 GOOGLE_CLIENT_SECRET、令牌加密密钥；GOOGLE_CLIENT_ID非保密但也仅服务端使用。仓库只提交占位示例。

CI：安装锁定依赖 → lint/typecheck → 单测 → Worker集成 → build → staging部署 → smoke/E2E → 人工批准production。迁移采取 expand/contract：先添加兼容字段/索引，备份验证后迁移，再部署引用新字段的代码，最后另版删除旧字段；不先部署依赖不存在表的代码。

不在配置中硬编码“未来能力已验证”；compatibility_date 选择经过测试的日期，升级单独跑回归。清理/同步 Cron 使用 UTC，前端展示本地时间并注明下一轮预计时间。

## 18｜运维、成本与恢复

结构化日志：requestId/jobId、匿名内部账号ID、阶段、耗时、错误码、attempt、对象数量；不含邮件正文、验证码、token、OAuth callback query、附件内容。错误追踪同样需要 scrub。

建议告警阈值（设计值）：连续3轮同步失败、最老pending job>15分钟、最老清理任务>24小时、解析失败率>5%且样本≥20、存储预算80%预警/95%暂停新邮箱或附件缓存。对新邮件不要在已经向SMTP确认成功后静默丢弃；容量不足应在接收策略与UI明确体现。

任务中心显示上次成功同步、最近错误、重试时间与清理积压。成本按 Workers请求/CPU、D1读写与容量、R2字节和操作、域名/Access计划、Gmail配额分别核算，不宣称零成本。例：100封/日×平均原始内容100KiB×30日≈293MiB仅为内容量级估算，未含附件、索引、副本与操作费用，不是账单报价。

备份：上线前确认D1当前计划恢复能力，制定离线导出/受限访问策略；R2清单与对象备份分别规划，恢复演练需涵盖数据库/对象时间点不一致。建议目标RPO24h、RTO4h，均待演练确认；若无法备份短期临时邮件，要明确其易失性而不承诺可恢复。

运行手册必须覆盖：DNS/MX故障、邮件未到达、解析失败、R2写失败、token失效、history404、清理卡死、密钥误删、资源预算耗尽、数据恢复。默认不自动删除日志/任务证据来“修复”错误。

## 19｜生产上线清单

- [ ] M0验证记录完整，收件域不影响现有主邮箱MX。
- [ ] 自定义域HTTPS、Access白名单、JWT验证、默认/预览入口均验证。
- [ ] 生产资源隔离，Secrets不在Git/客户端，回调query不进日志。
- [ ] D1兼容迁移已完成并验证，R2私有访问与对象归属校验通过。
- [ ] 外部邮箱真实投递：文本/HTML/附件/中文/畸形/超限覆盖。
- [ ] Gmail首次+增量、404重建、撤销、重授权、冷却与并发通过。
- [ ] HTML安全、附件越权、过期禁读、删除竞态测试通过。
- [ ] 清理/重试Cron正常，已完成一次故障注入与恢复演练。
- [ ] UI明确模拟/真实环境、同步窗口、本地已读、验证码不确定性。
- [ ] 同意隐私/保留策略，确认Google应用发布状态及适用要求。
- [ ] 回滚版本/触发条件/责任人明确，生产部署后用非敏感样本冒烟。

## 20｜尚需所有者确认的决定

未确认前采用本稿建议，不把建议冒充既定需求：
1. 接收域/子域实际名称与Cloudflare计划。
2. 是否接受Access单所有者登录；若不接受，需要单独设计会话/Passkey等认证，而不是删掉认证。
3. Gmail首次同步窗口7天/200封、只收Inbox、本地保留30天是否足够。
4. 临时邮箱60分钟/最大24小时、10个活跃地址是否符合用途。
5. 是否接受纯文本优先、默认无图片、未做附件病毒扫描、无发送功能。
6. 正式运行Gmail OAuth的发布/验证路径及可接受的预算。

本修订稿完成的是设计审查、执行基线和原型，不声称实际验证过你的域名、账号、Cloudflare资源或Google审核结果。先执行M0，通过后按里程碑推进。
