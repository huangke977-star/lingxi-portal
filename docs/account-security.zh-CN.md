# 账号安全

## 文档范围

本文说明 P2 账号安全能力的当前架构、配置方式、业务规则和上线操作。内容以 `apps/api/src/security`、`apps/api/src/auth`、Prisma 模型以及 Web 端认证与个人中心代码为准。

当前能力包括：

- 注册邮箱验证码和账号邮箱验证
- 邮箱找回密码和一次性重置令牌
- Cloudflare Turnstile 人机验证
- 登录失败限制、新设备、陌生 IP 和异常频率检测
- 非信任设备邮箱验证、浏览器安装级信任管理和活动会话退出
- 站内与邮件安全提醒及用户偏好
- 双因素认证、恢复码和通行密钥
- 敏感操作的统一二次验证与后台分页查询
- SMTP 与 Turnstile 凭据加密保存

当前不包含短信验证码、第三方账号登录和强制所有历史账号重新验证邮箱。

## 架构与数据

### 服务职责

- `AuthController` 和 `AuthService` 负责注册、登录、密码修改、密码重置、Token 签发和会话撤销。
- `AccountSecurityService` 负责验证码、密码找回请求、安全事件、已知设备、提醒和频率限制。
- `SecurityConfigurationService` 负责单例安全配置、公开策略和配置完整性检查。
- `MailService` 使用 Nodemailer 发送邮件，并把每次发送结果写入邮件任务表。
- `TurnstileService` 在服务端调用 Cloudflare `siteverify`，不信任浏览器单独给出的验证结果。
- `SecretCryptoService` 使用 AES-256-GCM 加密 SMTP 密码和 Turnstile Secret Key。
- MySQL 保存长期配置、请求记录、设备和事件；Redis 保存限流计数、Refresh Session 和登录失败状态。

### MySQL 数据

| 表                            | 用途                                                        | 重要说明                                                                              |
| ----------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `security_configurations`     | SMTP、邮件功能和 Turnstile 单例配置                         | SMTP 密码和 Turnstile Secret Key 仅保存密文；Site Key 可以公开                        |
| `user_security_preferences`   | 每个用户的安全提醒偏好                                      | 默认开启登录提醒、邮件提醒和新设备提醒                                                |
| `known_login_devices`         | 用户已出现过的浏览器/PWA 安装、设备名称、首末 IP 和信任时间 | 信任身份只保存服务端随机设备凭据的 SHA-256 哈希；取消信任会清空信任时间但保留审计记录 |
| `login_security_events`       | 登录、风险、密码和邮箱验证事件                              | 保存风险级别、IP、User-Agent、设备标签和必要元数据                                    |
| `email_verification_requests` | 注册、账号邮箱、新设备登录和敏感操作验证码请求              | 验证码只保存 HMAC 哈希；挑战只保存随机令牌的 SHA-256 哈希，并按用途、操作和设备绑定      |
| `password_reset_requests`     | 一次性密码重置请求                                          | 只保存令牌 SHA-256 哈希，不保存重置链接中的明文令牌                                   |
| `mail_jobs`                   | 邮件投递状态和失败原因                                      | 保存收件人、主题、类型、状态、次数和错误，不保存邮件正文                              |

迁移会把部署前已经存在的用户标记为邮箱已验证，验证时间取原账号创建时间，避免历史账号突然失去找回能力。新用户只有在启用注册邮箱验证并成功消费验证码时才会在注册时标记为已验证。用户修改邮箱后，邮箱验证状态会被清空，需要重新验证。

当前代码没有自动清理安全事件、已知设备、验证码请求和邮件任务的保留策略。生产长期运行后应根据审计周期另行制定清理策略，清理前先保留必要的安全审计证据。

### Redis 数据

| 键格式                                  | 用途                   | TTL / 限制                |
| --------------------------------------- | ---------------------- | ------------------------- |
| `security:code:email:<purpose>:<email>` | 同一邮箱发送验证码     | 每 60 秒 1 次             |
| `security:code:ip:<purpose>:<ip>`       | 同一 IP 发送验证码     | 每小时 10 次              |
| `security:recovery:email:<email>`       | 同一邮箱申请密码找回   | 每小时 3 次               |
| `security:recovery:ip:<ip>`             | 同一 IP 申请密码找回   | 每小时 10 次              |
| `login_fail:<account>:<ip>`             | 登录失败计数           | 15 分钟内 5 次后临时限制  |
| `refresh_token:<token-id>`              | Refresh Token 会话记录 | 跟随 Refresh Token 有效期 |
| `user_sessions:<user-id>`               | 用户会话索引           | 跟随 Refresh Token 有效期 |

Redis 中的限流键是临时状态。清空 Redis 会同时清除限流计数和 Refresh Session，因此不能把清空 Redis 当作普通维护操作。受保护的 HTTP 请求会确认 Access Token 中的 Session ID 仍存在；单独退出某个设备后，该设备的 Access Token 会立即失效，聊天 WebSocket 最迟约 15 秒断开。

## 接口与权限

### 公开认证接口

- `GET /auth/security-policy`：返回前端可公开使用的功能开关、Turnstile Site Key 和登录挑战阈值。
- `POST /auth/registration-code`：发送注册验证码。
- `POST /auth/register`：注册账号并在需要时消费验证码或验证 Turnstile。
- `POST /auth/login`：校验密码和必要的 Turnstile；启用非信任设备验证后，非信任浏览器只返回设备验证挑战，不签发 Token。
- `POST /auth/login/device-verification`：消费与当前浏览器凭据绑定的 6 位邮箱验证码，建立信任并完成登录。
- `POST /auth/login/device-verification/resend`：为仍然有效且属于当前浏览器的设备挑战重新发送验证码。
- `POST /auth/password-recovery/request`：申请密码找回邮件。
- `POST /auth/password-recovery/reset`：使用一次性令牌设置新密码。

### 登录用户接口

- `GET /auth/me/security`：读取邮箱状态、用户偏好、最近 30 条安全事件和最近 20 个信任设备，并标记当前浏览器。
- `PATCH /auth/me/security/preferences`：更新登录、邮件和新设备提醒开关。
- `POST /auth/me/email-verification/send`：向当前邮箱发送账号验证邮件。
- `POST /auth/me/email-verification/confirm`：确认当前账号的邮箱验证码。
- `PATCH /auth/me/password`：校验旧密码后修改密码，并撤销当前会话之外的 Refresh Session。
- `DELETE /auth/me/security/trusted-devices/:deviceId`：取消指定浏览器/PWA 安装的信任；保留当前会话，下次登录要求邮箱验证。
- `DELETE /auth/sessions/:sessionId`：退出当前账号的一条活动登录会话；可以退出当前设备或其他设备。
- `POST /account-privacy/me/security-verification/:action/email`：为注销账号、添加通行密钥或绑定双因素认证发送一次性邮箱验证码。
- `POST /account-privacy/me/security-verification/:action/email/verify`：验证对应操作的邮箱验证码并签发一次性敏感操作授权凭据。
- `POST /account-privacy/me/security-verification/:action/password`：用当前密码验证对应敏感操作并签发一次性授权凭据。
- `POST /account-privacy/me/security-verification/:action/totp`：用身份验证器验证码或恢复码验证对应敏感操作并签发一次性授权凭据。
- `POST /auth/me/security-verification/:action/passkey/options` 和 `/verify`：用通行密钥验证对应敏感操作并签发一次性授权凭据。
- `POST /account-privacy/me/deletion`、`POST /account-privacy/me/totp/enroll` 和 `POST /auth/me/passkeys/registration/options`：只接受匹配当前用户、操作和设备的一次性授权凭据。

Web 端已提供 `/register`、`/login`、`/forgot-password`、个人中心账号安全区域和 `/admin/security` 安全管理页。管理员与超级管理员可以从头像菜单进入安全管理；后端权限不会依赖前端隐藏。

### 后台接口权限

| 接口                             | 管理员         | 超级管理员     |
| -------------------------------- | -------------- | -------------- |
| `GET /security-admin/config`     | 可读取脱敏配置 | 可读取脱敏配置 |
| `GET /security-admin/overview`   | 可查询         | 可查询         |
| `PATCH /security-admin/config`   | 不可修改       | 可修改         |
| `POST /security-admin/smtp/test` | 不可执行       | 可执行         |

这里的“管理员”由角色等级 `>= 90` 判断；超级管理员还必须满足 `isSuperAdmin=true`。配置读取只返回 `smtpPasswordConfigured`、`turnstileSecretConfigured` 等状态，不返回两个 Secret 的明文。

## 敏感操作验证与输入规范

注销账号、添加通行密钥和绑定双因素认证都必须先完成一次敏感操作验证。用户可任选已配置的通行密钥、邮箱验证码、当前密码或双因素验证码/恢复码；验证成功后服务端签发只允许用于当前操作的授权凭据，凭据有效期 5 分钟、只能消费一次，并绑定当前用户、IP 和 User-Agent 指纹。操作类型不匹配、设备指纹变化、过期或重复使用都会被拒绝。邮箱验证码仍遵守 60 秒发送间隔和最多 5 次错误尝试限制。

通行密钥验证会先生成独立挑战，要求用户验证设备；成功后才可继续注册新的通行密钥。绑定双因素认证会先验证身份，再生成二维码/密钥和确认验证码。客户端取消通行密钥流程只结束当前流程，不应当被当作系统错误。

密码校验输入框统一使用以下规范：无边框、6px 圆角、`var(--surface-soft)` 背景、35px 最小高度、左侧 9px 内边距，右侧为密码显示按钮预留 44px 空间；获取焦点时只使用淡色 accent 阴影，不显示黑色边框。密码显示按钮位于输入框内部右侧，其他敏感验证码使用六个等宽小输入框，输入完成后自动校验。

## SMTP 配置

### 准备信息

从邮件服务商取得以下信息：

- SMTP 主机名
- SMTP 端口
- 是否使用隐式 TLS
- SMTP 用户名
- SMTP 密码或应用专用密码
- 发件人名称和发件邮箱

通常端口 `465` 配合隐式 TLS，端口 `587` 配合 STARTTLS，此时 `smtpSecure` 通常为 `false`。最终以邮件服务商的官方说明为准。不要把邮箱网页登录密码直接当作 SMTP 密码，优先使用服务商提供的应用专用密码。

### 推荐配置顺序

1. 先确认 API 容器已经配置有效的 `BACKUP_ENCRYPTION_KEY`，后台应显示凭据加密可用。
2. 保持注册验证和密码找回关闭，填写完整 SMTP 参数和密码，同时启用 SMTP 并保存。
3. 由超级管理员执行 SMTP 连接测试；当前 Web 页面只有在已保存的 SMTP 配置处于启用状态时才开放测试按钮。
4. 测试失败时先重新关闭 SMTP，修正参数后再重复保存和测试。
5. 分别启用注册邮箱验证和密码找回，每启用一项就完成一次真实收信验证。
6. 最后启用非信任设备邮箱验证，并保留一个已经登录的超级管理员会话作为回退入口。

配置更新支持省略密码以保留现有密文，也支持明确清除已保存密码。启用 SMTP、注册邮箱验证或密码找回时，主机、用户名、密码和发件地址必须完整，否则后端拒绝保存。

非信任设备邮箱验证同样依赖完整且已启用的 SMTP 配置。该开关默认关闭，不能在 SMTP 实际投递验证前开启。

示例只展示字段结构，不能填写仓库中的占位符作为生产凭据：

```json
{
  "smtpEnabled": false,
  "smtpHost": "smtp.provider.example",
  "smtpPort": 587,
  "smtpSecure": false,
  "smtpUsername": "mailer@example.com",
  "smtpPassword": "<provider-app-password>",
  "smtpFromName": "HLOVET",
  "smtpFromEmail": "mailer@example.com"
}
```

连接测试超时分别受到连接、问候和 Socket 超时限制。连接测试失败会直接返回明确错误；实际邮件发送失败还会把对应邮件任务记录为 `failed`，方便后台排查。

## Cloudflare Turnstile 配置

### Cloudflare 侧

1. 在 Cloudflare 控制台创建 Turnstile Widget。
2. 把正式域名和实际使用的测试域名加入允许的 Hostname；生产至少应包含当前站点域名。
3. 取得 Site Key 和 Secret Key。Site Key 提供给浏览器，Secret Key 只能由 API 使用。
4. 本地开发优先使用 Cloudflare 官方测试凭据或独立测试 Widget，不要为了本地调试放宽生产 Widget 的 Hostname。

Turnstile 不要求站点流量必须经过 Cloudflare 代理，但浏览器需要能够加载 `https://challenges.cloudflare.com/turnstile/v0/api.js`，API 服务器需要能够访问 `siteverify`。

### HLOVET 侧

1. 保持三个 Turnstile 开关关闭，先保存 Site Key 和 Secret Key。
2. 先启用注册或密码找回保护并验证完整流程。
3. 最后启用登录保护，并从较合理的失败阈值开始观察误触发情况。阈值允许 `1` 到 `5`，默认是 `3`。

三个开关分别控制：

- 注册：启用注册邮箱验证时，保护“发送验证码”；未启用邮箱验证时，保护最终注册请求。
- 登录：不是每次登录都显示挑战。当前账号与 IP 的失败次数达到配置阈值后，下一次登录必须先通过 Turnstile。
- 密码找回：同时保护找回邮件申请和最终密码重置，两个请求分别校验各自的 Turnstile Token。

缺少 Token 或验证失败时返回 HTTP `428`；Cloudflare 服务不可达或超时时返回 `503`。只有被相应开关保护的操作会被阻止。

## 注册验证与密码找回

### 注册邮箱验证

1. 前端读取公开安全策略。
2. 用户请求 6 位验证码；同一邮箱同一用途的旧待处理验证码立即过期。
3. 验证码 10 分钟有效，只以 HMAC 哈希保存。
4. 每个验证码最多允许 5 次错误尝试，之后需要重新获取。
5. 注册时原子消费最新有效验证码；验证码不能重复使用。
6. 注册成功后邮箱验证时间被写入用户记录。

账号已注册邮箱验证使用独立用途 `account_email`，不会与注册验证码混用。

### 信任设备与活动会话

1. API 在首次成功注册或密码校验后的设备挑战阶段，下发一年有效的 `HttpOnly`、`SameSite=Lax` 设备 Cookie；生产环境同时带 `Secure`。
2. 数据库只保存该随机值的 SHA-256 哈希，不保存可直接重放的 Cookie 明文。
3. 启用非信任设备邮箱验证后，密码和必要的 Turnstile 校验通过仍不会直接签发 Token；用户必须输入发送到账号邮箱的 6 位验证码。
4. 设备挑战 10 分钟有效、最多错误 5 次，并与发起登录的浏览器凭据绑定；其他浏览器不能消费该挑战。
5. 使用注册验证码完成注册时，当前浏览器直接成为信任设备，并记录“注册成功并登录”，不发送容易误解的新设备风险提醒。
6. 新设备验证码通过后成为信任设备，并记录“新设备通过邮箱验证并登录”；验证码邮件本身已是安全提醒，因此不再重复发送登录风险邮件。
7. 取消信任只影响下一次登录，不主动结束当前会话。退出登录设备是独立操作，会删除 Redis Session，并立即阻止该 Access Token 继续访问受保护接口。
8. 登录设备列表只来自 Redis 中仍有效的 Refresh Session，不展示已经过期或已经退出的历史会话。

网页和普通 PWA 无权读取硬盘序列号、主板号、IMEI 等物理硬件标识，因此系统不能把“整台物理设备”作为可靠唯一标识。当前信任边界是浏览器配置文件或 PWA 安装实例：清除站点 Cookie、使用无痕窗口、切换浏览器或重新安装应用会被视为新的设备实例。IP、User-Agent 和浏览器名称可能变化，只用于展示和风险分析，不作为信任身份。

### 密码找回

1. 只有状态正常且邮箱已验证的账号会收到找回邮件。
2. 对不存在、停用或邮箱未验证的账号，接口仍返回统一成功结果，避免泄露邮箱是否注册。
3. 新申请会使该用户之前未使用的重置请求过期。
4. 重置链接中的随机令牌有效期为 30 分钟，数据库只保存 SHA-256 哈希。
5. 令牌成功使用后立即标记为已消费，不能再次使用。
6. 新密码写入后，Redis 中该用户的全部 Refresh Session 会被撤销。

密码找回会同时递增账号安全版本号。Access Token 携带签发时的版本，后续请求发现版本不一致会立即返回 `401`；因此旧 Access Token 和全部 Refresh Session 都会失效。已登录用户通过旧密码正常修改密码时只撤销其他 Refresh Session，当前会话继续保留。

## 风险检测定义

分类有明确优先级：异常频率 > 新设备 > 陌生 IP > 普通登录。同一次登录只生成一个主类型。

| 类型                | 风险级别 | 当前定义                                                  |
| ------------------- | -------- | --------------------------------------------------------- |
| `login_success`     | `info`   | 已知设备、已知 IP 且未达到异常频率                        |
| `new_ip`            | `low`    | 当前 IP 未在该用户任何已知设备的首末 IP 中出现            |
| `new_device`        | `medium` | 设备指纹首次出现；首次登录通常同时是新 IP，但按新设备记录 |
| `unusual_frequency` | `high`   | 过去 10 分钟已有至少 5 条该用户登录类安全事件时再次登录   |
| `login_blocked`     | `high`   | 同一账号与 IP 在 15 分钟内达到 5 次登录失败               |
| `password_changed`  | `medium` | 用户通过旧密码修改密码                                    |
| `password_reset`    | `medium` | 用户通过邮箱令牌重置密码                                  |
| `email_verified`    | `info`   | 当前账号邮箱验证完成                                      |

信任设备指纹是服务端随机浏览器凭据的 SHA-256 哈希。旧版 `X-Device-ID` 或 User-Agent 哈希仍可用于历史风险记录兼容，但不能直接获得信任状态，也不能证明物理硬件身份。IP 来自可信反向代理传入的 `X-Forwarded-For` 首项；反向代理必须覆盖客户端伪造的该请求头。

新设备、陌生 IP 和异常频率事件在满足用户偏好时会创建站内系统消息。邮件提醒异步发送并吞掉投递异常，因此 SMTP 故障不会阻塞已经通过密码校验的普通登录；失败仍会写入邮件任务供后台查看。

## 用户偏好

个人中心提供三个独立开关：

- **登录提醒**：控制非普通登录事件的站内消息。
- **邮件提醒**：控制非普通登录事件的邮件提醒。
- **新设备提醒**：控制新设备事件是否发送提醒；关闭后仍保留安全事件记录。

偏好只影响提醒投递，不关闭登录事件、设备记录、登录失败限制或管理员审计。默认三个开关都开启。个人中心当前展示最近 5 条安全事件和最近 5 个设备，接口最多返回 30 条事件和 20 个设备。

## 后台查询

`GET /security-admin/overview` 支持 `page`、`pageSize`、`search` 和 `status`，默认每页 10 条，最大 100 条。

| `tab`          | 查询内容       | 搜索字段                     | 状态筛选                                     |
| -------------- | -------------- | ---------------------------- | -------------------------------------------- |
| `mail`         | 邮件任务       | 收件人、主题、最后错误       | `pending`、`sending`、`sent`、`failed`       |
| `verification` | 邮箱验证码请求 | 邮箱、IP                     | `pending`、`verified`、`consumed`、`expired` |
| `risk`         | 登录安全事件   | 摘要、IP、设备、用户名、昵称 | `info`、`low`、`medium`、`high`              |

返回结果按创建时间倒序。后台查询当前不包含密码重置请求列表，也不会返回重置令牌明文。验证码查询的底层数据包含不可逆的 `codeHash`，前端页面和日志不得把它当作验证码展示或导出。

## 频率限制汇总

- 验证码：邮箱每 60 秒 1 次，IP 每小时 10 次；注册与账号验证按用途分别计数。
- 密码找回：邮箱每小时 3 次，IP 每小时 10 次。
- 验证码错误：单个请求最多 5 次错误输入。
- 登录失败：账号与 IP 组合在 15 分钟内达到 5 次后限制登录。
- Turnstile 登录挑战：失败次数达到配置阈值后触发，阈值默认 3，不替代第 5 次失败锁定。
- Refresh Session：每个用户默认最多 10 个，具体值由 `MAX_REFRESH_SESSIONS_PER_USER` 控制。

超过请求限制时返回 HTTP `429`。限流依赖 Redis，不应通过清空缓存绕过正常安全策略。

## `BACKUP_ENCRYPTION_KEY`

该环境变量当前有两个用途：

1. 加密 MySQL 中保存的 SMTP 密码和 Turnstile Secret Key。
2. 加密异地数据库与媒体备份。

实现使用 AES-256-GCM，Key 必须准确解码为 32 字节，可以是 64 位十六进制或对应的 Base64。真实值只能存在于受保护的服务器环境文件和独立的秘密备份中：

- 不得写入 `docs`、README、源码、提交说明、截图或聊天记录。
- 不得提交 `.env`；仓库只允许 `.env.example` 中的明显占位符。
- 不得在日志或 API 响应中输出真实值。
- 至少保留一份离线或受访问控制的异地副本，并记录由谁保管。

丢失该 Key 后，已保存的 SMTP/Turnstile 凭据和使用它加密的远端备份都无法解密。替换成新的 Key 也不能解密旧数据。已经存在密文后不要直接轮换；轮换必须先用旧 Key 解密，再用新 Key 重新加密全部安全凭据和备份。无效长度会使 API 初始化失败，格式正确但值错误会在解密时失败。

`BACKUP_ENCRYPTION_KEY` 不用于用户密码哈希、JWT 签名或 HTTPS。用户密码由密码服务单独哈希，验证码 HMAC 和 Refresh Token HMAC 依赖 `REFRESH_TOKEN_SECRET`，该变量同样不得提交。

## 外部凭据未配置时的行为

| 情况                                     | 当前行为                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| SMTP 未配置或未启用                      | 默认注册仍可按站点开放策略进行，但不做邮箱验证；密码找回保持关闭；账号验证邮件会失败并产生失败任务 |
| 非信任设备邮箱验证关闭                   | 信任设备数据仍可记录和管理，但登录保持现有密码/Turnstile 流程，不增加邮箱步骤                      |
| 非信任设备邮箱验证开启但 SMTP 故障       | 非信任设备无法完成登录；应立即关闭该开关，信任设备仍按现有流程登录                                 |
| SMTP 在登录风险邮件发送时故障            | 普通登录不回滚；站内提醒和风险事件仍保留，邮件任务标记失败                                         |
| Turnstile 未配置或三个开关关闭           | `verify` 直接跳过，现有注册、登录和找回流程不依赖 Cloudflare                                       |
| Turnstile 已启用但脚本无法加载           | Web 无法取得 Token，被保护操作不能提交成功                                                         |
| Turnstile 已启用但 `siteverify` 不可达   | 被保护操作返回 `503`；未被该开关保护的功能继续工作                                                 |
| `BACKUP_ENCRYPTION_KEY` 未配置           | 可以读取非敏感配置并保持功能关闭；不能保存新的 SMTP/Turnstile Secret，也不能启用依赖完整凭据的功能 |
| `BACKUP_ENCRYPTION_KEY` 与已有密文不匹配 | 凭据无法解密，SMTP 测试、邮件发送和 Turnstile 校验失败；应恢复原 Key，不要覆盖密文                 |

默认配置下 SMTP、注册邮箱验证、密码找回、非信任设备邮箱验证和三个 Turnstile 开关均关闭，因此部署迁移本身不会把现有注册或登录流程绑定到外部服务。历史设备行不会自动获得信任状态。

## 上线步骤

1. 备份 MySQL，并确认备份可以读取；不要只依赖待上线的加密备份功能。
2. 确认生产 `.env` 中已有稳定的 `BACKUP_ENCRYPTION_KEY`、`JWT_ACCESS_SECRET` 和 `REFRESH_TOKEN_SECRET`，且真实值不在 Git 中；同时设置 `WEB_ORIGIN=https://5200918.xyz`，不得包含仅供宿主机或 Docker 内部使用的 `:3000` 端口。
3. 先保持所有新增邮件和 Turnstile 开关关闭。
4. 在构建环境完成 Prisma 生成、API 测试、前后端 Lint 和生产构建。
5. 在小型 VPS 上拉取 GHCR 预构建镜像，不在服务器本机构建镜像。
6. 先运行 `api-bootstrap` 完成增量迁移，再重建 API 和 Web；不要执行 `docker compose down -v`。
7. 验证首页、健康接口、原有登录、注册、Redis Session 和管理权限。
8. 配置并启用 SMTP，完成连接测试后先开启密码找回，再按需要开启注册邮箱验证。
9. 保持一个超级管理员浏览器处于登录状态，再开启非信任设备邮箱验证；使用普通账号在另一个浏览器完成首次验证和再次登录测试。
10. 配置 Turnstile，按注册/找回、登录的顺序逐项开启和验证。
11. 观察邮件失败、HTTP `401`/`428`/`429`/`503`、登录风险事件、Redis Session 和容器资源至少一个完整业务周期。

生产 Compose 的推荐命令顺序如下，镜像标签应替换为已经通过 CI 的版本：

```bash
docker compose -f docker-compose.prod.yml pull api-bootstrap api web
docker compose -f docker-compose.prod.yml run --rm api-bootstrap
docker compose -f docker-compose.prod.yml up -d --no-deps api web
docker compose -f docker-compose.prod.yml ps
```

## 回滚步骤

1. 如果故障来自邮件或 Turnstile，优先由超级管理员关闭对应功能开关；这是最快且不影响数据的回滚。
2. SMTP 故障时关闭邮件服务；系统会同步停用注册邮箱验证、密码找回、非信任设备邮箱验证和密码找回 Turnstile，避免登录或注册要求无法送达的验证码。
3. Turnstile 故障时分别关闭注册、登录和找回开关；不需要删除 Site Key 或密文 Secret。
4. 代码故障时，把 API 和 Web 回滚到上一组已验证镜像。P2 数据库迁移是新增表和可空字段，紧急回滚时保留这些表和列，不执行破坏性反向迁移。
5. 若解密失败，恢复原来的 `BACKUP_ENCRYPTION_KEY` 并只重建 API。不要用新 Key 覆盖或清空已有密文。
6. 回滚后验证原有登录、注册、Refresh Token 刷新、活动会话、管理员权限和健康接口。回滚旧代码时保留新增列和枚举值，不执行破坏性反向迁移。

## 验证步骤

### 自动化与构建

1. 执行 `pnpm --filter @lingxi/api prisma:generate`。
2. 执行 `pnpm --filter @lingxi/api test`，确认认证、会话、密码和 P2 安全测试通过。
3. 执行 `pnpm --filter @lingxi/api lint` 和 `pnpm --filter @lingxi/web lint`。
4. 执行 `pnpm --filter @lingxi/api build` 和 `pnpm --filter @lingxi/web build`。
5. 执行 `docker compose -f docker-compose.prod.yml config`，确认环境变量引用和服务依赖有效。

### 功能验证

1. 在全部新增开关关闭时完成一次原有注册和登录，确认迁移没有改变默认流程。
2. 保存 SMTP 配置并执行连接测试，再发送一封真实注册验证码邮件，确认邮件任务状态为 `sent`。
3. 对同一邮箱在 60 秒内再次申请验证码，确认返回 `429`；使用错误验证码 5 次后确认必须重新获取。
4. 启用注册邮箱验证，确认没有验证码不能注册、有效验证码只能消费一次、成功注册后邮箱为已验证。
5. 使用已验证账号申请找回，确认邮件链接以 `https://5200918.xyz/forgot-password` 开头、不包含 `:3000`，并且 30 分钟有效；用新密码重置后，旧 Access Token 和 Refresh Token 全部失效。
6. 对不存在、停用和未验证邮箱申请找回，确认页面得到相同的非枚举提示，且不会实际发送邮件。
7. 启用 Turnstile 注册或找回保护，确认无 Token 返回 `428`，有效挑战可继续，Cloudflare 不可达时返回 `503`。
8. 连续输错登录密码，确认达到挑战阈值后出现 Turnstile，达到 5 次后触发 15 分钟限制并记录 `login_blocked`。
9. 启用非信任设备邮箱验证，在新浏览器登录普通账号，确认密码通过后只出现 6 位验证码步骤且尚未获得 Token；在另一个浏览器使用同一挑战必须失败。
10. 输入正确验证码，确认登录成功、当前浏览器出现在“信任设备”且标记“当前设备”；退出后再次登录应不再要求邮箱验证码。
11. 取消当前设备信任，确认当前会话保持可用；退出后重新登录应再次要求邮箱验证码。清除 Cookie、切换浏览器或使用 PWA 独立安装也应视为新的设备实例。
12. 同一账号建立两个活动会话，在个人中心分别退出其他设备和当前设备；被退出设备的 HTTP 请求应立即返回 `401`，聊天连接应在约 15 秒内断开。
13. 检查登录设备区域只显示有效 Redis Session，标题下方没有异常空白，桌面和 390px 移动端均无横向溢出。
14. 检查个人中心的邮箱状态、提醒开关和安全事件；关闭新设备提醒后再次制造新设备事件，确认事件仍记录但不发送相应提醒。
15. 分别以管理员和超级管理员测试后台：两者都能查询邮件、验证码和风险事件，只有超级管理员能修改配置和测试 SMTP。
16. 临时使用错误 SMTP 地址制造发送失败，确认邮件任务记录错误；普通登录风险邮件失败时确认登录本身仍成功，非信任设备验证失败时确认可以通过关闭对应开关回滚。
17. 检查 API 响应、容器日志、浏览器网络记录和 Git 历史，确认没有 SMTP 密码、Turnstile Secret、设备 Cookie、验证码、挑战令牌、重置令牌或 `BACKUP_ENCRYPTION_KEY` 明文。
18. 生产验证结束后恢复正确配置，删除测试账号和不再需要的测试邮件记录时遵循审计保留要求。
