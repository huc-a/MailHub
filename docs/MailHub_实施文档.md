# 邮箱聚合工作台：从需求到上线的完整实施方案

根据你确定的方向，我建议把项目设计成一个个人自用的 Cloudflare 邮箱工作台：既能创建临时邮箱、接收验证码，也能接入自己已有的 Gmail、Outlook 等邮箱，在同一个 Vue 3 界面查看邮件。

技术路线采用 Vue 3 + TypeScript + Cloudflare Workers + D1 + R2，尽可能不需要独立 Linux 服务器。

有一个重要的架构决定：临时邮箱和已有邮箱必须使用两套不同的邮件接入适配器，但共享同一套前端界面、邮件展示模型和查询 API。 不要把两类邮箱的底层接收方式混在一起。

## 一、产品定位与第一版目标

项目暂定名称：`MailHub`

[Mymail | Email Dashboard by Azzura Samiatunnisa for Visoeal Studio on Dribbble](https://images.openai.com/static-rsc-4/KeC-1bOx_JoSWMRSYq3quorFvvd1wXX8mIMeo2Gs8Gt_gbiBPSYWFZj148CJ4iAoopjy1T8XEWJJThmd23GeND6MQvGKK_tghBkrjGoAW6gUHatkQ4rn_umtF3Vgd9A8FbMfYOTZXQbh6BrtrJ8_TcBRZJ2anoTabpEaCjZyJxk?purpose=inline)

## MailHub

个人邮箱聚合工作台

统一管理临时邮箱与个人已有邮箱，提供邮件阅读、验证码提取、自动刷新和过期清理。

统一收件箱

多个邮箱，一个入口

验证码提取

自动识别常见验证码

自动刷新

定时同步与新邮件提示

私密访问

个人授权、邮箱隔离和安全清理

### 第一版的边界

| 功能        | 第一版范围                                             |
| ----------- | ------------------------------------------------------ |
| 临时邮箱    | 创建随机地址、接收邮件、查看邮件、过期删除             |
| 已有邮箱    | 优先接入 Gmail API；之后接入 Outlook / Microsoft Graph |
| 统一收件箱  | 按邮箱来源、时间、已读状态过滤                         |
| 验证码提取  | 提取常见数字或字母数字验证码，并允许手动复制           |
| 自动刷新    | 前端轮询；已有邮箱由后台定时同步                       |
| 邮件详情    | 纯文本、HTML 隔离预览、基础附件信息                    |
| 个人设置    | 邮箱有效期、同步间隔、主题与刷新开关                   |
| 发送邮件    | 第一版不实现                                           |
| 多用户 SaaS | 暂不实现，但数据模型保留账户隔离能力                   |

这里的“已有邮箱聚合”指你授权访问自己拥有的邮箱，不是自动获取任何人的邮箱，也不意味着所有服务商都允许用相同方式接入。

## 二、整体架构

Vue 3 + TypeScript 前端

统一收件箱、邮件详情、验证码卡片、设置

Cloudflare Workers

REST API · 认证授权 · 邮箱适配器 · 邮件解析 · 限流

D1 数据库

邮箱、邮件元数据、同步游标、任务记录

R2 对象存储

邮件正文、原始邮件及附件对象

入站邮件适配器

Cloudflare Email Routing → Worker

定时同步

Cron Triggers → Gmail / Outlook 同步任务

OAuth 2.0 / 加密凭证

授权邮箱访问、刷新令牌、撤销授权与密钥管理

### 两条独立的邮件接入链路

链路 A：临时邮箱

外部发件人 → 邮件域名 → Cloudflare Email Routing → Worker 邮件处理器 → 解析邮件 → D1 / R2 → 前端。

链路 B：已有邮箱

用户 OAuth 授权 → 安全保存令牌 → Cron 定时触发 → Gmail API 或 Microsoft Graph → 同步邮件 → D1 / R2 → 前端。

这两条链路最后汇入同一个内部邮件数据模型，所以前端不需要关心一封邮件来自临时邮箱还是 Gmail。

### Cloudflare 各服务的职责

| 服务               | 用途                                     |
| ------------------ | ---------------------------------------- |
| Workers            | REST API、OAuth 回调、邮件处理与同步逻辑 |
| Workers Assets     | 托管 Vue 构建后的静态资源                |
| D1                 | 结构化数据、索引、同步状态               |
| R2                 | 邮件正文、原始 MIME、附件                |
| Cron Triggers      | 定时同步已有邮箱、清理过期数据           |
| Secrets / 加密密钥 | OAuth 客户端密钥、数据加密密钥           |
| Email Routing      | 临时邮箱域名的入站邮件路由               |

建议第一版不引入 KV、Queues、Durable Objects。等邮件量、同步并发或实时推送确实需要时再加，避免初期架构过度复杂。

## 三、完整 PRD：产品需求文档

### 3.1 用户使用流程

\#chatgpt-mermaid-_r_s9_{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;fill:rgb(13, 13, 13);}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#chatgpt-mermaid-_r_s9_ .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-_r_s9_ .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-_r_s9_ .error-icon{fill:rgb(243, 243, 243);}#chatgpt-mermaid-_r_s9_ .error-text{fill:rgb(13, 13, 13);stroke:rgb(13, 13, 13);}#chatgpt-mermaid-_r_s9_ .edge-thickness-normal{stroke-width:1px;}#chatgpt-mermaid-_r_s9_ .edge-thickness-thick{stroke-width:3.5px;}#chatgpt-mermaid-_r_s9_ .edge-pattern-solid{stroke-dasharray:0;}#chatgpt-mermaid-_r_s9_ .edge-thickness-invisible{stroke-width:0;fill:none;}#chatgpt-mermaid-_r_s9_ .edge-pattern-dashed{stroke-dasharray:3;}#chatgpt-mermaid-_r_s9_ .edge-pattern-dotted{stroke-dasharray:2;}#chatgpt-mermaid-_r_s9_ .marker{fill:rgb(143, 143, 143);stroke:rgb(143, 143, 143);}#chatgpt-mermaid-_r_s9_ .marker.cross{stroke:rgb(143, 143, 143);}#chatgpt-mermaid-_r_s9_ svg{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;}#chatgpt-mermaid-_r_s9_ p{margin:0;}#chatgpt-mermaid-_r_s9_ .label{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";color:rgb(13, 13, 13);}#chatgpt-mermaid-_r_s9_ .cluster-label text{fill:rgb(13, 13, 13);}#chatgpt-mermaid-_r_s9_ .cluster-label span{color:rgb(13, 13, 13);}#chatgpt-mermaid-_r_s9_ .cluster-label span p{background-color:transparent;}#chatgpt-mermaid-_r_s9_ .label text,#chatgpt-mermaid-_r_s9_ span{fill:rgb(13, 13, 13);color:rgb(13, 13, 13);}#chatgpt-mermaid-_r_s9_ .node rect,#chatgpt-mermaid-_r_s9_ .node circle,#chatgpt-mermaid-_r_s9_ .node ellipse,#chatgpt-mermaid-_r_s9_ .node polygon,#chatgpt-mermaid-_r_s9_ .node path{fill:rgb(222, 234, 251);stroke:rgb(83, 154, 248);stroke-width:1px;}#chatgpt-mermaid-_r_s9_ .rough-node .label text,#chatgpt-mermaid-_r_s9_ .node .label text,#chatgpt-mermaid-_r_s9_ .image-shape .label,#chatgpt-mermaid-_r_s9_ .icon-shape .label{text-anchor:middle;}#chatgpt-mermaid-_r_s9_ .node .katex path{fill:#000;stroke:#000;stroke-width:1px;}#chatgpt-mermaid-_r_s9_ .rough-node .label,#chatgpt-mermaid-_r_s9_ .node .label,#chatgpt-mermaid-_r_s9_ .image-shape .label,#chatgpt-mermaid-_r_s9_ .icon-shape .label{text-align:center;}#chatgpt-mermaid-_r_s9_ .node.clickable{cursor:pointer;}#chatgpt-mermaid-_r_s9_ .root .anchor path{fill:rgb(143, 143, 143)!important;stroke-width:0;stroke:rgb(143, 143, 143);}#chatgpt-mermaid-_r_s9_ .arrowheadPath{fill:rgb(143, 143, 143);}#chatgpt-mermaid-_r_s9_ .edgePath .path{stroke:rgb(143, 143, 143);stroke-width:1px;}#chatgpt-mermaid-_r_s9_ .flowchart-link{stroke:rgb(143, 143, 143);fill:none;}#chatgpt-mermaid-_r_s9_ .edgeLabel{background-color:rgb(252, 252, 252);text-align:center;}#chatgpt-mermaid-_r_s9_ .edgeLabel p{background-color:rgb(252, 252, 252);}#chatgpt-mermaid-_r_s9_ .edgeLabel rect{opacity:0.5;background-color:rgb(252, 252, 252);fill:rgb(252, 252, 252);}#chatgpt-mermaid-_r_s9_ .labelBkg{background-color:rgba(252, 252, 252, 0.5);}#chatgpt-mermaid-_r_s9_ .cluster rect{fill:rgb(243, 243, 243);stroke:rgba(0, 0, 0, 0.1);stroke-width:1px;}#chatgpt-mermaid-_r_s9_ .cluster text{fill:rgb(13, 13, 13);}#chatgpt-mermaid-_r_s9_ .cluster span{color:rgb(13, 13, 13);}#chatgpt-mermaid-_r_s9_ div.mermaidTooltip{position:absolute;text-align:center;max-width:200px;padding:2px;font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:12px;background:rgb(243, 243, 243);border:1px solid rgba(0, 0, 0, 0.1);border-radius:2px;pointer-events:none;z-index:100;}#chatgpt-mermaid-_r_s9_ .flowchartTitleText{text-anchor:middle;font-size:18px;fill:rgb(13, 13, 13);}#chatgpt-mermaid-_r_s9_ rect.text{fill:none;stroke-width:0;}#chatgpt-mermaid-_r_s9_ .icon-shape,#chatgpt-mermaid-_r_s9_ .image-shape{background-color:rgb(252, 252, 252);text-align:center;}#chatgpt-mermaid-_r_s9_ .icon-shape p,#chatgpt-mermaid-_r_s9_ .image-shape p{background-color:rgb(252, 252, 252);padding:2px;}#chatgpt-mermaid-_r_s9_ .icon-shape .label rect,#chatgpt-mermaid-_r_s9_ .image-shape .label rect{opacity:0.5;background-color:rgb(252, 252, 252);fill:rgb(252, 252, 252);}#chatgpt-mermaid-_r_s9_ .label-icon{display:inline-block;height:1em;overflow:visible;vertical-align:-0.125em;}#chatgpt-mermaid-_r_s9_ .node .label-icon path{fill:currentColor;stroke:revert;stroke-width:revert;}#chatgpt-mermaid-_r_s9_ .node .neo-node{stroke:rgb(83, 154, 248);}#chatgpt-mermaid-_r_s9_ [data-look="neo"].node rect,#chatgpt-mermaid-_r_s9_ [data-look="neo"].cluster rect,#chatgpt-mermaid-_r_s9_ [data-look="neo"].node polygon{stroke:url(#chatgpt-mermaid-_r_s9_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-_r_s9_ [data-look="neo"].swimlane.cluster rect{filter:none;}#chatgpt-mermaid-_r_s9_ [data-look="neo"].node path{stroke:url(#chatgpt-mermaid-_r_s9_-gradient);stroke-width:1px;}#chatgpt-mermaid-_r_s9_ [data-look="neo"].node .outer-path{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-_r_s9_ [data-look="neo"].node .neo-line path{stroke:rgb(83, 154, 248);filter:none;}#chatgpt-mermaid-_r_s9_ [data-look="neo"].node circle{stroke:url(#chatgpt-mermaid-_r_s9_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-_r_s9_ [data-look="neo"].node circle .state-start{fill:#000000;}#chatgpt-mermaid-_r_s9_ [data-look="neo"].icon-shape .icon{fill:url(#chatgpt-mermaid-_r_s9_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-_r_s9_ [data-look="neo"].icon-shape .icon-neo path{stroke:url(#chatgpt-mermaid-_r_s9_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-_r_s9_ .node text{font-size:14px;font-weight:600;letter-spacing:normal;fill:rgb(0, 79, 153);}#chatgpt-mermaid-_r_s9_ .edgeLabels text{font-size:13px;font-weight:600;letter-spacing:-0.08px;fill:rgb(0, 79, 153);}#chatgpt-mermaid-_r_s9_ .node tspan[font-weight="normal"],#chatgpt-mermaid-_r_s9_ .edgeLabels tspan[font-weight="normal"]{font-weight:600;}#chatgpt-mermaid-_r_s9_ .edgeLabel .label rect{opacity:1;rx:13px;ry:13px;fill:rgb(245, 250, 255);stroke:rgb(206, 219, 229);stroke-width:1px;}#chatgpt-mermaid-_r_s9_ .node rect,#chatgpt-mermaid-_r_s9_ .node circle,#chatgpt-mermaid-_r_s9_ .node ellipse,#chatgpt-mermaid-_r_s9_ .node polygon,#chatgpt-mermaid-_r_s9_ .node path{fill:rgb(229, 243, 255);stroke:rgba(0, 0, 0, 0.1);stroke-width:1px;}#chatgpt-mermaid-_r_s9_ .node rect{rx:16px;ry:16px;}#chatgpt-mermaid-_r_s9_ .mermaid-decision .label-container{fill:rgb(245, 250, 255);stroke:rgb(206, 219, 229);stroke-dasharray:2,2;}#chatgpt-mermaid-_r_s9_ .edgePaths .flowchart-link{stroke:rgb(143, 143, 143);stroke-width:1px;stroke-linecap:round;stroke-linejoin:round;}#chatgpt-mermaid-_r_s9_ .marker{fill:rgb(143, 143, 143);stroke:rgb(143, 143, 143);}#chatgpt-mermaid-_r_s9_ :root{--mermaid-font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";}打开 MailHub进入统一收件箱选择邮箱类型创建临时邮箱授权已有邮箱接收外部邮件同步 Gmail / Outlook统一邮件数据模型查看邮件列表打开邮件详情提取并复制验证码手动刷新 / 自动刷新

### 3.2 功能需求与验收标准

| 编号  | 模块     | 功能需求       | 验收标准                             |
| ----- | -------- | -------------- | ------------------------------------ |
| FR-01 | 临时邮箱 | 创建随机地址   | 返回唯一地址和访问凭据               |
| FR-02 | 临时邮箱 | 设置有效期     | 到期后不再允许读取或继续接收         |
| FR-03 | 邮件接收 | 处理入站邮件   | 能正确匹配邮箱并保存邮件             |
| FR-04 | 已有邮箱 | OAuth 授权     | 授权成功后显示已连接账号             |
| FR-05 | 邮件同步 | 增量同步       | 重复同步不会重复插入邮件             |
| FR-06 | 收件箱   | 统一展示       | 不同来源使用统一列表格式             |
| FR-07 | 验证码   | 自动提取       | 识别常见验证码，并保留手动复制能力   |
| FR-08 | 邮件详情 | 查看正文       | 正文可读，HTML 内容不具备执行权限    |
| FR-09 | 自动刷新 | 定时刷新       | 更新邮件列表，失败时展示状态         |
| FR-10 | 数据管理 | 删除邮箱及数据 | 删除后按约定清理关联内容             |
| FR-11 | 安全     | 资源授权       | 未授权请求不能读取邮件或附件         |
| FR-12 | 可观测性 | 错误记录       | 可以定位同步失败、邮件解析失败等问题 |

### 3.3 页面设计

第一版只需要五个核心页面或视图：

[Mail dashboard by Marina on Dribbble](https://images.openai.com/static-rsc-4/fCPMI5FNL5xhPaDzp3xwWFLUr1BKtP3mFcF-oLbCx6YRcV_iXlBKr6iv1YPgyWnUPhVDrljTBjsOWIC0Nms7M-vzcMvfck4S7yTSaaf1pwfvpMNqkpns_sdA-2UjaqVBiHVppFmSG607xvI4oWfYVjz_RUrrcXaIqE29dzNpms8?purpose=inline)

统一收件箱 `/`

左侧邮箱列表、顶部搜索、邮件列表、来源筛选、未读状态、刷新按钮。

[Switch Account Menu by Louis Nguyen on Dribbble](https://images.openai.com/static-rsc-4/Qxv6myVDIhx19wYYdZy2RY836V0CrZPwCmR-MB9q3luvnouetUhbEeZoQC4PLaHEhqg9uCKeiB6MEbuf9Q_TVXTu_E9Aa56SOrHceq7DUuTFIwiT4cIw2EKcBTERNaMo16Fg1D_7ffbyul4eEUl6zuaxskSpZrfEN0CFYaUhzHs?purpose=inline)

邮件详情 `/mail/:id`

发件人、收件人、时间、正文、验证码卡片和附件列表。

[Web testing for beginners: How to test email services with temporary mail](https://images.openai.com/static-rsc-4/XfduN_6jvi4849jcE04Z9tf1Vd-kiN4dvUv0qLcG3peNxcIF9Wn26x92OEsXkqk4mHZ4VA5e5bf05EZXDba_PL9VPZetd4RZZccSF39V1llPC--GGI6F3LanJZ2uSzYe2vwpmpr-oMeGIzOV3MMJGKS3fYhmYskKd5faJ2UG79k?purpose=inline)

临时邮箱 `/temporary`

创建地址、复制地址、显示有效期、查看该邮箱收件箱。

[Email Triage with Trish AI: Reclaim 200+ Hours/Year per Employee - Blog - Trisk CPA](https://images.openai.com/static-rsc-4/OfIGQgPPHRqrojwYBpdnH83izb_IpyqAJL5_fpgg3mAWyZM9OxSI_DtQjzt_iZsNxFcsZjvKEAMA-tZ_gsKvJn1UAw9b6cqAXFRN0ugAv9O-AzUiexcQIVvZgBRDe9DQoZ-FDnaxIb6d5P2asNcV20rhxqNGDP5NIyqSfhWj_KM?purpose=inline)

邮箱连接 `/accounts`

连接 Gmail、查看同步状态、手动同步、撤销授权。

[Elapsd](https://images.openai.com/static-rsc-4/d_KpZArfyX87AfvcJOtp2UzhjyMKkgkLsVLdoP6TwhmxXUwpl-Wr6OVukjfA7p__7n8VWPbkyqbTmuNwRwLH5V49ZE2O99ZhBfi_LS-_-hb1y01dPlTgcyJlXvvnZ0xfVwkY5bZrTnF0QhjeJthdHVCmuJqgRNSJsJ7IvsaAYqA?purpose=inline)

设置 `/settings`

刷新频率、主题、数据保留期、隐私设置和清理操作。

### 3.4 非功能需求

- 性能：收件箱默认分页，列表只返回元数据，不一次性加载所有正文。
- 可靠性：邮件同步支持重试，使用唯一约束避免重复邮件。
- 安全性：默认只读访问已有邮箱，不请求发送邮件权限。
- 隐私：不在日志中记录验证码、邮件正文、OAuth 令牌。
- 可维护性：每种邮箱来源实现独立的 `MailProvider` 接口。
- 可扩展性：以后可以增加 IMAP 兼容服务、更多 OAuth 提供商或搜索功能。

## 四、关键技术决策：Cloudflare 上怎样实现混合邮箱

这部分是项目最容易走错的地方。

### 4.1 临时邮箱域名与路由

你需要一个自己控制、已接入 Cloudflare DNS 的域名，例如：

```
inbox.example.com
```

建议使用独立子域名接收临时邮件，避免与个人主要邮箱域名的配置互相影响。

接收链路：

1. 在 Cloudflare Email Routing 中接入域名。
2. 配置邮件路由，把目标邮件交给 Worker。
3. Worker 读取收件人地址，匹配 D1 中的有效临时邮箱。
4. 解析邮件，保存元数据与正文。
5. 前端通过 API 查询邮件。

官方文档明确支持把入站邮件路由到 Worker 进行自定义处理。

Cloudflare Email Service docs+1



关键限制： 先验证你的域名和账户支持的路由规则能否满足动态临时地址的需求。不要假设创建一个 Worker 后，所有随机生成的地址就会自动生效。如果必须为每个地址创建独立规则，规则数量可能成为瓶颈；应优先验证 catch-all（兜底路由）或适合动态地址的路由机制。

还要注意，Cloudflare Email Routing 主要解决入站邮件处理，不会自动提供完整邮箱协议、长期邮箱存储或通用 SMTP 发信能力。

### 4.2 已有邮箱授权

已有邮箱不应该通过用户提供的邮箱密码来登录。应使用官方 OAuth 2.0 授权。

第一阶段推荐 Gmail：

- 授权方式：OAuth 2.0 Authorization Code Flow。
- 最小权限：优先使用只读邮件权限。
- 同步方式：Worker 定时调用 Gmail API。
- 令牌管理：服务端加密保存 refresh token。
- 断开连接：撤销授权，并删除本地凭证。

Google 官方文档说明，服务器端 OAuth 流程可以获取访问令牌和用于后续续期的刷新令牌。

Google for Developers+1



Outlook 可以在下一阶段接入 Microsoft Graph 的委托权限。

Microsoft Learn+1



对于个人自用，Google OAuth 应用可以先处于测试阶段并限制为自己的测试账号；但应提前确认 Gmail API 的授权范围、测试模式令牌有效期以及应用验证要求，避免上线后出现授权突然失效的情况。

### 4.3 统一邮件适配器

建议定义统一接口，所有邮箱来源都转换为同一种数据结构：

```
export interface MailProvider {
  listMessages(
    accountId: string,
    cursor?: string
  ): Promise<MailPage>;

  getMessage(
    accountId: string,
    providerMessageId: string
  ): Promise<NormalizedEmail>;

  sync(
    accountId: string,
    cursor?: string
  ): Promise<SyncResult>;

  revoke?(accountId: string): Promise<void>;
}
```

对应实现：

```
MailProvider
├── TemporaryMailProvider
├── GmailProvider
└── OutlookProvider       # 后续
```

临时邮箱实际由入站邮件事件驱动，不必真的去远程拉取邮件；可以让它实现相同的统一数据接口，而 `sync()` 对临时邮箱返回本地处理状态。

这样以后增加新的邮箱来源时，不需要重写前端。

## 五、项目目录结构

为了让前端、REST API、入站邮件和定时任务共用一个 Cloudflare Worker，建议采用单仓库结构。

```
mailhub/
├── src/
│   ├── client/                     # Vue 3 前端
│   │   ├── main.ts
│   │   ├── App.vue
│   │   ├── router/
│   │   ├── components/
│   │   │   ├── AppSidebar.vue
│   │   │   ├── InboxList.vue
│   │   │   ├── EmailDetail.vue
│   │   │   ├── VerificationCode.vue
│   │   │   └── MailboxSelector.vue
│   │   ├── pages/
│   │   │   ├── InboxPage.vue
│   │   │   ├── TemporaryPage.vue
│   │   │   ├── AccountsPage.vue
│   │   │   └── SettingsPage.vue
│   │   ├── stores/
│   │   │   ├── inbox.ts
│   │   │   └── settings.ts
│   │   └── api/
│   │       ├── http.ts
│   │       ├── emails.ts
│   │       └── mailboxes.ts
│   │
│   └── server/
│       ├── index.ts                # Worker 入口
│       ├── router.ts               # API 路由
│       ├── routes/
│       │   ├── mailboxes.ts
│       │   ├── emails.ts
│       │   ├── accounts.ts
│       │   └── oauth.ts
│       ├── providers/
│       │   ├── types.ts
│       │   ├── temporary.ts
│       │   ├── gmail.ts
│       │   └── outlook.ts
│       ├── services/
│       │   ├── mail-service.ts
│       │   ├── sync-service.ts
│       │   ├── mime-parser.ts
│       │   ├── verification-code.ts
│       │   └── encryption.ts
│       ├── middleware/
│       │   ├── auth.ts
│       │   ├── rate-limit.ts
│       │   └── error-handler.ts
│       ├── jobs/
│       │   ├── sync-mailboxes.ts
│       │   └── cleanup.ts
│       └── utils/
│
├── migrations/
│   ├── 0001_initial.sql
│   └── 0002_indexes.sql
├── tests/
│   ├── unit/
│   ├── api/
│   └── integration/
├── public/
├── package.json
├── vite.config.ts
├── wrangler.jsonc
├── tsconfig.json
├── .dev.vars.example
└── README.md
```

`outlook.ts` 可以先放一个待实现的适配器接口，也可以等第二阶段再创建。第一阶段真正实现 Gmail 与临时邮箱两条链路即可。

## 六、数据库设计与初始化 SQL

建议让 D1 存储邮件索引、邮箱关系和同步状态，R2 存储邮件正文与附件对象。

### 6.1 核心数据关系

\#chatgpt-mermaid-_r_um_{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;fill:rgb(13, 13, 13);}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#chatgpt-mermaid-_r_um_ .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-_r_um_ .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-_r_um_ .error-icon{fill:rgb(243, 243, 243);}#chatgpt-mermaid-_r_um_ .error-text{fill:rgb(13, 13, 13);stroke:rgb(13, 13, 13);}#chatgpt-mermaid-_r_um_ .edge-thickness-normal{stroke-width:1px;}#chatgpt-mermaid-_r_um_ .edge-thickness-thick{stroke-width:3.5px;}#chatgpt-mermaid-_r_um_ .edge-pattern-solid{stroke-dasharray:0;}#chatgpt-mermaid-_r_um_ .edge-thickness-invisible{stroke-width:0;fill:none;}#chatgpt-mermaid-_r_um_ .edge-pattern-dashed{stroke-dasharray:3;}#chatgpt-mermaid-_r_um_ .edge-pattern-dotted{stroke-dasharray:2;}#chatgpt-mermaid-_r_um_ .marker{fill:rgb(143, 143, 143);stroke:rgb(143, 143, 143);}#chatgpt-mermaid-_r_um_ .marker.cross{stroke:rgb(143, 143, 143);}#chatgpt-mermaid-_r_um_ svg{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;}#chatgpt-mermaid-_r_um_ p{margin:0;}#chatgpt-mermaid-_r_um_ .entityBox{fill:rgb(222, 234, 251);stroke:rgb(83, 154, 248);}#chatgpt-mermaid-_r_um_ .relationshipLabelBox{fill:rgb(243, 243, 243);opacity:0.7;background-color:rgb(243, 243, 243);}#chatgpt-mermaid-_r_um_ .relationshipLabelBox rect{opacity:0.5;}#chatgpt-mermaid-_r_um_ .labelBkg{background-color:rgba(243, 243, 243, 0.5);}#chatgpt-mermaid-_r_um_ .edgeLabel{background-color:rgb(252, 252, 252);}#chatgpt-mermaid-_r_um_ .edgeLabel .label rect{fill:rgb(252, 252, 252);}#chatgpt-mermaid-_r_um_ .edgeLabel .label text{fill:rgb(13, 13, 13);}#chatgpt-mermaid-_r_um_ .edgeLabel .label{fill:rgb(83, 154, 248);font-size:14px;}#chatgpt-mermaid-_r_um_ .label{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";color:rgb(13, 13, 13);}#chatgpt-mermaid-_r_um_ .edge-pattern-dashed{stroke-dasharray:8,8;}#chatgpt-mermaid-_r_um_ .node rect,#chatgpt-mermaid-_r_um_ .node circle,#chatgpt-mermaid-_r_um_ .node ellipse,#chatgpt-mermaid-_r_um_ .node polygon{fill:rgb(222, 234, 251);stroke:rgb(83, 154, 248);stroke-width:1px;}#chatgpt-mermaid-_r_um_ .relationshipLine{stroke:rgb(143, 143, 143);stroke-width:1px;fill:none;}#chatgpt-mermaid-_r_um_ .marker{fill:none!important;stroke:rgb(143, 143, 143)!important;stroke-width:1;}#chatgpt-mermaid-_r_um_ [data-look=neo].labelBkg{background-color:rgba(243, 243, 243, 0.5);}#chatgpt-mermaid-_r_um_ .node .neo-node{stroke:rgb(83, 154, 248);}#chatgpt-mermaid-_r_um_ [data-look="neo"].node rect,#chatgpt-mermaid-_r_um_ [data-look="neo"].cluster rect,#chatgpt-mermaid-_r_um_ [data-look="neo"].node polygon{stroke:url(#chatgpt-mermaid-_r_um_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-_r_um_ [data-look="neo"].swimlane.cluster rect{filter:none;}#chatgpt-mermaid-_r_um_ [data-look="neo"].node path{stroke:url(#chatgpt-mermaid-_r_um_-gradient);stroke-width:1px;}#chatgpt-mermaid-_r_um_ [data-look="neo"].node .outer-path{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-_r_um_ [data-look="neo"].node .neo-line path{stroke:rgb(83, 154, 248);filter:none;}#chatgpt-mermaid-_r_um_ [data-look="neo"].node circle{stroke:url(#chatgpt-mermaid-_r_um_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-_r_um_ [data-look="neo"].node circle .state-start{fill:#000000;}#chatgpt-mermaid-_r_um_ [data-look="neo"].icon-shape .icon{fill:url(#chatgpt-mermaid-_r_um_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-_r_um_ [data-look="neo"].icon-shape .icon-neo path{stroke:url(#chatgpt-mermaid-_r_um_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-_r_um_ :root{--mermaid-font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";}USERStextidPKtextcreated_atMAILBOXEStextidPKtextuser_idFKtextaddresstextexpires_atPROVIDER_ACCOUNTStextidPKtextuser_idFKtextprovidertextencrypted_refresh_tokenEMAILStextidPKtextmailbox_idFKtextprovider_account_idFKtextprovider_message_idtextsubjecttextreceived_atEMAIL_BODIEStextemail_idPKtexttext_object_keytexthtml_object_keyEMAIL_ATTACHMENTStextidPKtextemail_idFKtextobject_keyOAUTH_STATESownsauthorizesreceivessyncsstorescontainsinitiates

`users` 代表 MailHub 的本地用户，而不是 Gmail 账号。即使第一版只有你一个人使用，也建议保留 `user_id`，这样不会把邮箱访问权与邮箱地址混为一谈。

### 6.2 初始化 SQL

创建 `migrations/0001_initial.sql`：

```
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mailboxes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  address TEXT NOT NULL COLLATE NOCASE UNIQUE,
  access_token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'deleted')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS provider_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL
    CHECK (provider IN ('gmail', 'outlook')),
  email_address TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  scopes TEXT NOT NULL DEFAULT '',
  sync_cursor TEXT,
  sync_status TEXT NOT NULL DEFAULT 'idle',
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, provider, email_address)
);

CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  mailbox_id TEXT REFERENCES mailboxes(id),
  provider_account_id TEXT REFERENCES provider_accounts(id),
  provider_message_id TEXT NOT NULL,
  message_id_header TEXT,
  from_address TEXT NOT NULL DEFAULT '',
  to_addresses TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  verification_code TEXT,
  received_at TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (mailbox_id IS NOT NULL AND provider_account_id IS NULL)
    OR
    (mailbox_id IS NULL AND provider_account_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_temp_provider_message
ON emails(mailbox_id, provider_message_id)
WHERE mailbox_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_connected_provider_message
ON emails(provider_account_id, provider_message_id)
WHERE provider_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_emails_user_received
ON emails(user_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_emails_mailbox_received
ON emails(mailbox_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_emails_provider_received
ON emails(provider_account_id, received_at DESC);

CREATE TABLE IF NOT EXISTS email_bodies (
  email_id TEXT PRIMARY KEY REFERENCES emails(id) ON DELETE CASCADE,
  text_object_key TEXT,
  html_object_key TEXT,
  raw_object_key TEXT
);

CREATE TABLE IF NOT EXISTS email_attachments (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  object_key TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  code_verifier TEXT,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  user_id TEXT NOT NULL REFERENCES users(id),
  setting_key TEXT NOT NULL,
  setting_value TEXT NOT NULL,
  PRIMARY KEY(user_id, setting_key)
);
```

这份 SQL 是 MVP 的基础结构。后续还应补充邮箱删除任务、同步失败记录、加密密钥版本及数据清理状态等字段。

注意两个实现细节：

1. D1 的外键约束不代表用户授权已经通过校验。每个 API 仍然需要验证当前用户与资源的归属关系。
2. R2 对象不受 D1 外键约束。删除邮件时，必须单独删除关联的正文、原始邮件和附件对象，或者创建可靠的异步清理任务。

### 6.3 R2 对象命名

建议采用随机 ID，而不是把发件人、邮箱地址或主题写进对象路径：

```
mail/{userId}/{emailId}/body.txt
mail/{userId}/{emailId}/body.html
mail/{userId}/{emailId}/raw.eml
attachments/{userId}/{emailId}/{attachmentId}
```

所有对象都设置私有访问权限，只能由经过授权的 Worker 读取。不要把 R2 对象公开成永久可访问的公共 URL。

## 七、API 接口设计

API 使用 `/api/v1` 作为版本前缀，所有业务接口统一返回 JSON。

### 7.1 临时邮箱接口

| 方法     | 路径                          | 作用                   |
| -------- | ----------------------------- | ---------------------- |
| `POST`   | `/api/v1/mailboxes`           | 创建临时邮箱           |
| `GET`    | `/api/v1/mailboxes`           | 查询当前用户的邮箱列表 |
| `GET`    | `/api/v1/mailboxes/:id`       | 查询邮箱详情           |
| `DELETE` | `/api/v1/mailboxes/:id`       | 删除邮箱               |
| `POST`   | `/api/v1/mailboxes/:id/renew` | 续期邮箱               |

创建请求示例：

```
{
  "ttlMinutes": 60
}
```

服务端生成地址、随机访问凭据及过期时间。`ttlMinutes` 必须由服务端校验范围，不能让客户端设置无限期邮箱。

### 7.2 邮件接口

| 方法    | 路径                                           | 作用               |
| ------- | ---------------------------------------------- | ------------------ |
| `GET`   | `/api/v1/emails`                               | 统一收件箱         |
| `GET`   | `/api/v1/emails/:id`                           | 邮件详情           |
| `PATCH` | `/api/v1/emails/:id`                           | 标记已读等操作     |
| `GET`   | `/api/v1/emails/:id/attachments/:attachmentId` | 安全获取附件       |
| `POST`  | `/api/v1/emails/refresh`                       | 请求立即刷新或同步 |

收件箱查询参数示例：

```
GET /api/v1/emails?source=all&limit=30&cursor=...
GET /api/v1/emails?source=temporary&limit=30
GET /api/v1/emails?source=gmail&unread=true
```

建议使用基于时间与唯一 ID 的游标分页，不要长期使用大偏移量分页。

邮件列表响应示例：

```
{
  "items": [
    {
      "id": "email_abc123",
      "source": "gmail",
      "from": "noreply@example.com",
      "subject": "Your verification code",
      "receivedAt": "2026-10-28T06:00:00.000Z",
      "isRead": false,
      "verificationCode": "482913"
    }
  ],
  "nextCursor": null
}
```

以上是接口格式示例，实际邮件内容由你的邮箱服务提供，不是预置的真实邮件。

### 7.3 已有邮箱接口

| 方法     | 路径                             | 作用             |
| -------- | -------------------------------- | ---------------- |
| `GET`    | `/api/v1/accounts`               | 查询已连接账号   |
| `GET`    | `/api/v1/accounts/gmail/connect` | 开始 Gmail OAuth |
| `GET`    | `/api/v1/oauth/gmail/callback`   | 处理 OAuth 回调  |
| `POST`   | `/api/v1/accounts/:id/sync`      | 请求同步         |
| `DELETE` | `/api/v1/accounts/:id`           | 断开账号连接     |

OAuth 回调必须校验一次性 `state`，并在服务端交换授权码。PKCE 可以作为额外防护。刷新令牌必须加密保存，不能发送给 Vue 前端。

Google for Developers+1



### 7.4 验证码提取逻辑

推荐把验证码提取做成独立服务：

```
export function extractVerificationCode(
  subject: string,
  textBody: string,
  htmlBody: string
): string | null {
  // 1. 优先检查主题和明确的验证码关键词附近文本
  // 2. 清除 HTML 标签及不可见内容
  // 3. 识别常见的 4–8 位数字或字母数字组合
  // 4. 排除日期、金额、订单号等明显干扰
  // 5. 无法判断时返回 null，不猜测
  return null;
}
```

这是函数接口的骨架，具体识别逻辑需要后续实现。

不要简单地使用 `/\d{6}/` 就认为找到了验证码。邮件中可能同时包含日期、订单号、电话号码或多个数字。建议保存提取结果及其来源位置，允许用户手动复制原文。

## 八、开发环境与 Cloudflare 配置

### 8.1 初始化项目

在 Windows PowerShell 或 WSL 中执行均可，建议选定一个环境并保持 Node、npm 和 Wrangler 一致。

```
npm create cloudflare@latest -- mailhub --framework=vue
cd mailhub
npm install
npm run dev
```

如果脚手架的交互选项发生变化，以当前 CLI 提示为准。确认项目能启动后，再接入 D1、R2 和 Worker API。Cloudflare 官方文档可以参考 [Vue + Workers 开发指南](https://developers.cloudflare.com/workers/framework-guides/web-apps/vue/?utm_source=chatgpt.com)。

### 8.2 创建 Cloudflare 资源

安装并登录 Wrangler：

```
npx wrangler login
npx wrangler whoami
```

创建 D1：

```
npx wrangler d1 create mailhub-db
```

创建 R2：

```
npx wrangler r2 bucket create mailhub-storage
```

创建完成后，记下 D1 返回的数据库 ID。R2 Bucket 名称也要与配置保持一致。

### 8.3 配置 `wrangler.jsonc`

下面是一个配置示例。将数据库 ID 替换成你创建 D1 时实际返回的值；如果脚手架已经生成该文件，保留模板所需的 Vite/Workers 配置，再合并下面的绑定，不要直接覆盖整个配置。

```
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "mailhub",
  "main": "src/server/index.ts",
  "compatibility_date": "2026-10-28",
  "assets": {
    "directory": "./dist/client",
    "not_found_handling": "single-page-application",
    "binding": "ASSETS"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "mailhub-db",
      "database_id": "替换为你的D1数据库ID"
    }
  ],
  "r2_buckets": [
    {
      "binding": "MAIL_STORAGE",
      "bucket_name": "mailhub-storage"
    }
  ],
  "triggers": {
    "crons": [
      "*/5 * * * *",
      "17 3 * * *"
    ]
  }
}
```

这份配置展示的是目标绑定关系，不保证直接适用于每一种 Vue 脚手架生成结果。尤其是 `assets.directory`，应与你实际构建产物目录一致；如果模板采用 Cloudflare Vite 插件托管静态资源，应遵循模板原有的构建与资产配置。

Cron 表达式的含义：

- `*/5 * * * *`：每五分钟执行一次同步调度。
- `17 3 * * *`：每天 UTC 03:17 执行一次清理。

Cloudflare Cron Triggers 使用 UTC 时间，并通过 Worker 的 `scheduled()` 处理器执行任务。

Cloudflare Workers docs



不要让每次 Cron 都无差别拉取所有邮件。 应根据账号的同步游标、上次同步时间和任务状态决定需要处理哪些账号。

### 8.4 绑定环境变量与密钥

本地开发使用 `.dev.vars`（加入 `.gitignore`，不要提交）：

```
APP_BASE_URL=http://localhost:5173
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-local-client-secret
TOKEN_ENCRYPTION_KEY=replace-with-a-random-32-byte-key
```

正式环境通过 Wrangler 设置密钥：

```
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY
```

生产环境的 `APP_BASE_URL` 可以放入非敏感配置中。不要将 OAuth Secret、令牌加密密钥或真实 refresh token 写入源代码、前端环境变量或 Git 仓库。

`TOKEN_ENCRYPTION_KEY` 的示例值只是占位符。实际密钥应使用密码学安全的随机生成方式，并做好安全备份与密钥轮换设计。

### 8.5 迁移数据库

先在本地执行迁移：

```
npx wrangler d1 migrations apply mailhub-db --local
```

验证 SQL 没有问题后，再应用到生产环境：

```
npx wrangler d1 migrations apply mailhub-db --remote
```

建议所有结构变化都通过编号迁移文件完成，而不是直接手动修改线上数据库。

## 九、Worker 核心实现结构

Worker 需要处理三类入口：HTTP API、入站邮件和定时任务。

可以把 `src/server/index.ts` 设计成如下结构：

```
interface Env {
  DB: D1Database;
  MAIL_STORAGE: R2Bucket;
  ASSETS: Fetcher;

  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      // 认证、路由、参数校验、错误处理
      return handleApi(request, env, ctx);
    }

    // 其他请求交给 Vue 静态资源
    return env.ASSETS.fetch(request);
  },

  async email(message: ForwardableEmailMessage, env: Env) {
    // 1. 校验收件人和域名
    // 2. 查找有效的临时邮箱
    // 3. 解析 MIME 内容
    // 4. 保存 R2 对象
    // 5. 写入 D1 元数据
    // 6. 对异常情况记录不含敏感内容的日志
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ) {
    // 根据 cron 类型执行同步或清理
    ctx.waitUntil(runScheduledJobs(controller, env));
  }
};
```

这是架构骨架，不是可直接编译运行的完整 Worker：`handleApi`、`runScheduledJobs`、邮件解析、认证和事务补偿逻辑需要在后续步骤中实现。

需要注意，`email()` 事件和 `fetch()` API 是不同的事件入口。前端轮询收件箱不等于邮件接收；Cron 定时任务也不等于邮件同步已经实现。

### 9.1 邮件接收的正确顺序

建议采用以下处理顺序：

1. 检查收件地址是否属于你的临时邮箱域名。
2. 在 D1 查询邮箱是否存在、是否有效。
3. 解析 MIME，限制正文大小、附件大小和解析耗时。
4. 生成内部唯一邮件 ID。
5. 将正文与附件写入 R2。
6. 在 D1 中以唯一约束插入邮件元数据和对象索引。
7. 对失败操作进行清理或重试，避免出现 D1 记录存在但 R2 对象缺失的孤儿状态。

D1 和 R2 不是一个共同事务，因此必须考虑写入中途失败的情况。初期可以采用幂等插入与失败补偿；后续再引入异步任务队列。

### 9.2 MIME 解析

建议先评估适用于 Workers 的 MIME 解析库，例如 `postal-mime`，并通过实际邮件样本验证：

- `text/plain` 正文。
- `text/html` 正文。
- 多段 MIME 内容。
- 常见字符编码。
- 内嵌图片与附件。
- 畸形或超大邮件。

不要用简单的字符串切割解析 `.eml`，因为邮件头折行、字符编码、MIME 边界和附件编码都会导致错误。

## 十、前端实现与自动刷新

### 10.1 统一邮件类型

在 `src/client/types/email.ts` 中定义前端数据模型：

```
export type MailSource = "temporary" | "gmail" | "outlook";

export interface EmailSummary {
  id: string;
  source: MailSource;
  from: string;
  subject: string;
  receivedAt: string;
  isRead: boolean;
  hasAttachments: boolean;
  verificationCode: string | null;
}

export interface EmailDetail extends EmailSummary {
  to: string[];
  textBody: string | null;
  htmlAvailable: boolean;
  attachments: {
    id: string;
    filename: string;
    sizeBytes: number;
    contentType: string;
  }[];
}
```

这里的 `htmlAvailable` 表示存在 HTML 正文，不代表允许直接把原始 HTML 插入页面。

### 10.2 自动刷新策略

第一版不需要 WebSocket，使用前端轮询即可：

- 页面处于前台时，每 15–30 秒请求一次邮件列表。
- 页面处于后台时降低刷新频率，或者暂停轮询。
- 用户手动刷新时允许立即发起请求，但应有防抖与并发限制。
- 已有邮箱的远程同步由 Cron 负责，前端轮询只读取本地同步结果。
- 同步失败时显示上次同步时间与错误状态，不应无限重试。

Vue 组件可以使用 `onMounted`、`onUnmounted` 与 `setInterval` 实现，并在组件卸载时清理定时器。更推荐把轮询逻辑封装到 `useInboxPolling()`，避免多个组件重复请求。

另外，刷新按钮应区分两个动作：

- 刷新列表： 重新读取 D1 中已有的邮件。
- 立即同步： 请求从 Gmail 或 Outlook 获取最新邮件。

二者不能混为一谈，否则用户点击刷新时可能误以为远程邮箱已完成同步。

### 10.3 HTML 邮件安全预览

邮件正文是外部不可信内容。建议：

1. 默认优先展示纯文本。
2. HTML 邮件使用独立的沙箱 iframe 预览，禁用脚本与顶层导航。
3. 不允许任意远程资源自动加载，避免跟踪像素泄露访问信息。
4. 附件使用授权后的后端下载接口，不直接暴露 R2 Bucket。
5. 过滤危险协议，例如 `javascript:`，并限制外部链接行为。

## 十一、已有邮箱接入：Gmail OAuth 实施顺序

建议先接入 Gmail，再扩展 Outlook。

Gmail APIGoogle OAuthMailHub Worker用户浏览器Gmail APIGoogle OAuthMailHub Worker用户浏览器#chatgpt-mermaid-_r_12c_{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;fill:rgb(13, 13, 13);}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#chatgpt-mermaid-_r_12c_ .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-_r_12c_ .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-_r_12c_ .error-icon{fill:rgb(243, 243, 243);}#chatgpt-mermaid-_r_12c_ .error-text{fill:rgb(13, 13, 13);stroke:rgb(13, 13, 13);}#chatgpt-mermaid-_r_12c_ .edge-thickness-normal{stroke-width:1px;}#chatgpt-mermaid-_r_12c_ .edge-thickness-thick{stroke-width:3.5px;}#chatgpt-mermaid-_r_12c_ .edge-pattern-solid{stroke-dasharray:0;}#chatgpt-mermaid-_r_12c_ .edge-thickness-invisible{stroke-width:0;fill:none;}#chatgpt-mermaid-_r_12c_ .edge-pattern-dashed{stroke-dasharray:3;}#chatgpt-mermaid-_r_12c_ .edge-pattern-dotted{stroke-dasharray:2;}#chatgpt-mermaid-_r_12c_ .marker{fill:rgb(143, 143, 143);stroke:rgb(143, 143, 143);}#chatgpt-mermaid-_r_12c_ .marker.cross{stroke:rgb(143, 143, 143);}#chatgpt-mermaid-_r_12c_ svg{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;}#chatgpt-mermaid-_r_12c_ p{margin:0;}#chatgpt-mermaid-_r_12c_ .actor{stroke:rgb(83, 154, 248);fill:rgb(222, 234, 251);stroke-width:1;}#chatgpt-mermaid-_r_12c_ rect.actor.outer-path[data-look="neo"]{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-_r_12c_ rect.note[data-look="neo"]{stroke:rgb(107, 198, 127);fill:rgb(243, 243, 243);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-_r_12c_ text.actor>tspan{fill:rgb(13, 13, 13);stroke:none;}#chatgpt-mermaid-_r_12c_ .actor-line{stroke:rgb(143, 143, 143);}#chatgpt-mermaid-_r_12c_ .innerArc{stroke-width:1.5;stroke-dasharray:none;}#chatgpt-mermaid-_r_12c_ .messageLine0{stroke-width:1.5;stroke-dasharray:none;stroke:rgb(143, 143, 143);}#chatgpt-mermaid-_r_12c_ .messageLine1{stroke-width:1.5;stroke-dasharray:2,2;stroke:rgb(143, 143, 143);}#chatgpt-mermaid-_r_12c_ [id$="-arrowhead"] path{fill:rgb(143, 143, 143);stroke:rgb(143, 143, 143);}#chatgpt-mermaid-_r_12c_ .sequenceNumber{fill:#707070;}#chatgpt-mermaid-_r_12c_ [id$="-sequencenumber"]{fill:rgb(143, 143, 143);}#chatgpt-mermaid-_r_12c_ [id$="-crosshead"] path{fill:rgb(143, 143, 143);stroke:rgb(143, 143, 143);}#chatgpt-mermaid-_r_12c_ .messageText{fill:rgb(13, 13, 13);stroke:none;}#chatgpt-mermaid-_r_12c_ .labelBox{stroke:rgba(0, 0, 0, 0.1);fill:rgb(252, 252, 252);filter:none;}#chatgpt-mermaid-_r_12c_ .labelText,#chatgpt-mermaid-_r_12c_ .labelText>tspan{fill:rgb(13, 13, 13);stroke:none;}#chatgpt-mermaid-_r_12c_ .loopText,#chatgpt-mermaid-_r_12c_ .loopText>tspan{fill:rgb(13, 13, 13);stroke:none;}#chatgpt-mermaid-_r_12c_ .sectionTitle,#chatgpt-mermaid-_r_12c_ .sectionTitle>tspan{fill:rgb(13, 13, 13);stroke:none;}#chatgpt-mermaid-_r_12c_ .loopLine{stroke-width:2px;stroke-dasharray:2,2;stroke:rgba(0, 0, 0, 0.1);fill:rgba(0, 0, 0, 0.1);}#chatgpt-mermaid-_r_12c_ .note{stroke:rgb(107, 198, 127);fill:rgb(243, 243, 243);}#chatgpt-mermaid-_r_12c_ .noteText,#chatgpt-mermaid-_r_12c_ .noteText>tspan{fill:rgb(13, 13, 13);stroke:none;font-weight:normal;}#chatgpt-mermaid-_r_12c_ .activation0{fill:rgb(243, 243, 243);stroke:hsl(0, 0%, 85.2941176471%);}#chatgpt-mermaid-_r_12c_ .activation1{fill:rgb(243, 243, 243);stroke:hsl(0, 0%, 85.2941176471%);}#chatgpt-mermaid-_r_12c_ .activation2{fill:rgb(243, 243, 243);stroke:hsl(0, 0%, 85.2941176471%);}#chatgpt-mermaid-_r_12c_ .actorPopupMenu{position:absolute;}#chatgpt-mermaid-_r_12c_ .actorPopupMenuPanel{position:absolute;fill:rgb(222, 234, 251);box-shadow:0px 8px 16px 0px rgba(0,0,0,0.2);filter:drop-shadow(3px 5px 2px rgb(0 0 0 / 0.4));}#chatgpt-mermaid-_r_12c_ .actor-man circle,#chatgpt-mermaid-_r_12c_ line{fill:rgb(222, 234, 251);stroke-width:2px;}#chatgpt-mermaid-_r_12c_ g rect.rect{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));stroke:rgb(83, 154, 248);}#chatgpt-mermaid-_r_12c_ .node .neo-node{stroke:rgb(83, 154, 248);}#chatgpt-mermaid-_r_12c_ [data-look="neo"].node rect,#chatgpt-mermaid-_r_12c_ [data-look="neo"].cluster rect,#chatgpt-mermaid-_r_12c_ [data-look="neo"].node polygon{stroke:url(#chatgpt-mermaid-_r_12c_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-_r_12c_ [data-look="neo"].swimlane.cluster rect{filter:none;}#chatgpt-mermaid-_r_12c_ [data-look="neo"].node path{stroke:url(#chatgpt-mermaid-_r_12c_-gradient);stroke-width:1px;}#chatgpt-mermaid-_r_12c_ [data-look="neo"].node .outer-path{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-_r_12c_ [data-look="neo"].node .neo-line path{stroke:rgb(83, 154, 248);filter:none;}#chatgpt-mermaid-_r_12c_ [data-look="neo"].node circle{stroke:url(#chatgpt-mermaid-_r_12c_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-_r_12c_ [data-look="neo"].node circle .state-start{fill:#000000;}#chatgpt-mermaid-_r_12c_ [data-look="neo"].icon-shape .icon{fill:url(#chatgpt-mermaid-_r_12c_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-_r_12c_ [data-look="neo"].icon-shape .icon-neo path{stroke:url(#chatgpt-mermaid-_r_12c_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-_r_12c_ :root{--mermaid-font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";}请求连接 Gmail创建一次性 state重定向至 Google 授权用户登录并授权回调 code 与 state验证 state使用 code 交换 tokenaccess token 与 refresh token加密保存 refresh token读取邮件列表与详情返回邮件数据归一化并幂等写入 D1 / R2

具体执行步骤：

1. 在 Google Cloud Console 创建项目并启用 Gmail API。
2. 配置 OAuth 同意屏幕、测试用户与授权范围。
3. 创建 Web application 类型的 OAuth 客户端。
4. 添加本地与生产环境的授权回调 URL。
5. 在 Worker 实现 `state` 校验和授权码交换。
6. 加密保存 refresh token，并实现令牌刷新与撤销。
7. 实现邮件列表、详情和增量同步。
8. 测试令牌过期、用户撤销授权、API 限流等情况。

建议先申请最小的只读权限，例如 `gmail.readonly`。不要一开始申请发送邮件或管理全部邮箱设置的权限。

Google OAuth 的测试与正式发布要求会因授权范围而不同。个人使用可以先限定测试用户，但要确认测试状态下的刷新令牌有效期与后续发布要求。参考官方文档：[Gmail API 服务端 OAuth](https://developers.google.com/workspace/gmail/api/auth/web-server?utm_source=chatgpt.com)。

## 十二、开发计划：按里程碑推进

建议将整个项目拆成七个阶段，每阶段都设置可以验证的交付物。

阶段 1

项目初始化与 UI 原型

Vue 页面、路由、模拟邮件数据、统一布局。

验收：可运行的网站，能浏览模拟收件箱与邮件详情。

阶段 2

D1 / R2 与基础 API

数据库迁移、认证中间件、邮箱 CRUD、邮件列表与详情 API。

验收：前端能读取真实数据库数据。

阶段 3

临时邮箱接收

域名路由、MIME 解析、入站 Worker、正文存储。

验收：外部邮件可以进入网站并显示。

阶段 4

验证码与邮件详情

验证码提取、HTML 隔离预览、附件信息与下载。

验收：邮件详情可用，验证码识别有测试覆盖。

阶段 5

Gmail OAuth 与同步

授权、令牌加密、邮件同步游标、重复数据处理。

验收：自己的 Gmail 邮件可以进入统一收件箱。

阶段 6

安全与自动化

轮询、Cron、过期清理、异常恢复、权限与安全测试。

验收：异常情况不会导致邮件泄露或永久残留。

阶段 7

生产部署与验收

绑定域名、生产迁移、配置 secrets、真实投递与 OAuth 验证。

验收：完成真实环境端到端测试。

建议顺序不要颠倒：先让真实邮件接收链路跑通，再投入大量时间开发高级 UI；先实现 Gmail 只读同步，再考虑多个提供商和复杂搜索。

## 十三、测试方案与上线验收

建议使用 Vitest 测试业务逻辑，使用 Cloudflare 的本地开发环境测试 Workers、D1 和 R2，再用真实测试邮箱完成端到端验证。

### 13.1 测试矩阵

| 测试类别   | 关键测试                       | 预期结果                     |
| ---------- | ------------------------------ | ---------------------------- |
| 单元测试   | 验证码提取、MIME 解析          | 正确识别，不确定时不误判     |
| 数据库测试 | 邮件插入、重复同步             | 重复邮件不会重复入库         |
| API 测试   | 未登录、错误令牌、越权读取     | 拒绝未授权请求               |
| 邮件接收   | 有效地址、过期地址、未知地址   | 正确处理或拒绝               |
| OAuth 测试 | 错误 state、过期令牌、撤销授权 | 不泄露凭证，能提示重新授权   |
| 存储测试   | R2 写入失败、D1 写入失败       | 能清理或补偿，不留下错误记录 |
| 前端测试   | 自动刷新、分页、详情展示       | 不重复请求，不显示错误数据   |
| 安全测试   | XSS、恶意附件、路径遍历        | 不执行恶意内容，不越权下载   |
| 部署测试   | 域名、HTTPS、Cron、邮件路由    | 生产环境链路完整             |

### 13.2 推荐测试命令

先根据脚手架配置安装测试工具：

```
npm install -D vitest
```

在 `package.json` 中配置测试脚本：

```
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

然后逐步运行：

```
npm run test
npm run build
npx wrangler dev
```

上面是基础命令示例。如果脚手架已经有 `test`、`build` 或 `dev` 脚本，保留其原有配置，并补充缺少的测试脚本即可。

### 13.3 必须通过的安全验收

- 临时邮箱地址不能直接作为邮件读取权限。
- 一个邮箱的访问凭据不能读取另一个邮箱的邮件。
- OAuth refresh token 不出现在前端、日志和 Git 中。
- HTML 邮件无法执行脚本或跳出预览隔离环境。
- 附件下载需要校验邮件和邮箱归属。
- 邮箱到期后无法继续读取邮件。
- 删除邮箱后，D1 和 R2 的数据都能按策略清理。
- 自动同步失败不会导致重复插入或无限重试。
- 未配置域名、OAuth 或存储时，系统会返回清晰错误，而不是泄露内部信息。

## 十四、生产部署步骤

### 第一步：构建并部署 Worker

在本地构建：

```
npm run build
```

确认 Wrangler 配置、构建产物路径、D1 和 R2 绑定都正确后：

```
npx wrangler deploy
```

如果你的 Vue 脚手架使用 Cloudflare Vite 插件，则优先遵循脚手架生成的部署命令，避免绕过必要的构建步骤。

### 第二步：配置生产数据库

确认迁移文件已提交，再执行：

```
npx wrangler d1 migrations apply mailhub-db --remote
```

生产环境不要使用本地数据库测试时的数据作为真实用户数据。

### 第三步：配置域名

在 Cloudflare Dashboard 中：

1. 添加并验证你拥有的域名。
2. 配置 Worker 自定义域名或相应的站点域名。
3. 检查 HTTPS 是否正常。
4. 配置入站邮件域名与 MX 记录。
5. 将临时邮箱的入站邮件路由到 Worker。
6. 发送真实测试邮件，检查 Worker 日志、D1 记录与 R2 对象。

Email Routing 的配置要求和路由方式可参考 [Cloudflare Email Routing 官方指南](https://developers.cloudflare.com/email-service/get-started/route-emails/?utm_source=chatgpt.com)。

### 第四步：配置 OAuth 生产回调

在 Google Cloud Console 添加生产回调地址，例如：

```
https://mail.example.com/api/v1/oauth/gmail/callback
```

这只是示例，必须与你实际实现的路由一致。

确保以下配置完全匹配：

- Google OAuth 中的回调 URL。
- Worker 实际提供的回调路径。
- 应用使用的生产域名。
- Cookie 的 Secure、HttpOnly、SameSite 等属性。
- OAuth `state` 与 PKCE 校验。

### 第五步：生产环境端到端测试

按这个顺序验证：

1. 打开网站并创建临时邮箱。
2. 从外部邮箱向临时邮箱发送测试邮件。
3. 确认邮件进入 Worker。
4. 确认 D1 中存在邮件记录。
5. 确认 R2 中存在正文对象。
6. 在网页中查看邮件详情并复制验证码。
7. 授权自己的 Gmail，触发一次手动同步。
8. 确认 Gmail 邮件进入统一收件箱。
9. 等待自动同步，确认没有重复邮件。
10. 删除测试邮箱，确认数据清理符合预期。

## 十五、成本、限制与后续扩展

Cloudflare 可以让你避免维护常驻服务器，但不代表整个邮件系统必然零成本。

需要关注的项目包括：

- Workers 的请求量、CPU 时间及定时任务消耗。
- D1 数据库容量、查询和写入用量。
- R2 存储、读取及操作次数。
- 邮件服务的接收限制与账户规则。
- Gmail API 配额和 OAuth 应用要求。
- 邮件正文、附件持续增长造成的存储成本。

Cloudflare Email Routing 的当前限制可参考 [Email Routing 限制文档](https://developers.cloudflare.com/email-service/platform/limits/?utm_source=chatgpt.com)。部署前应重新核对计划、地区与功能限制，不要把某个免费额度直接等同于无限制使用。

后续可以按需扩展：

- Outlook / Microsoft Graph。
- 搜索邮件正文。
- 收藏、标签和自定义过滤规则。
- 新邮件通知。
- IMAP 接入适配器。
- 邮件 AI 摘要与翻译。
- WebSocket 实时推送。
- 多设备设置同步。

## 十六、建议你现在实际开始做什么

我建议先完成一个垂直切片：从页面到数据库，再到真实邮件接收，确保整条链路可用，而不是一次生成所有文件。

## 第一轮开发任务清单

按顺序执行，每完成一步就验证一次。

进度

### 0/10

创建 Vue 3 + TypeScript + Cloudflare 项目

完成统一收件箱与邮件详情的模拟页面

创建 D1、R2 并执行初始 SQL 迁移

实现邮箱 CRUD 与邮件列表 API

实现 MIME 解析和验证码提取单元测试

验证域名入站路由能否动态接收临时地址

实现真实邮件存储与前端读取

接入 Gmail OAuth 只读授权和同步

实现自动刷新、过期清理和安全测试

完成生产部署与端到端验收

复制开发任务清单

最后提醒一个影响整个项目可行性的关键点： 在投入大量开发前，先验证你准备使用的 Cloudflare 邮件域名能否通过合适的兜底路由把动态生成的地址交给 Worker。已有邮箱聚合的技术路径相对明确；真正决定临时邮箱方案能否按预期运行的，是入站邮件路由、动态地址匹配、存储和安全这条链路。

如果这条链路跑通，后续的 Vue 界面、D1 数据模型、邮件详情和验证码提取都可以按上述设计逐步实现。