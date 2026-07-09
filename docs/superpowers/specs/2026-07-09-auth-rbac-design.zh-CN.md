# 认证与角色权限基础设计

日期：2026-07-09

## 目标

建设灵犀门户第二阶段：真正可用的认证与角色权限基础，让后续导航、页面、工具、服务器入口和后台管理模块都能复用。

本阶段先让“用户身份”变成真实能力，再继续叠加内容管理功能。用户应该可以注册、登录、刷新会话、退出登录，并获取当前账号信息。后端应该能够判断当前用户是否已登录、属于哪个角色、是否是系统 `admin`、以及是否满足最低角色等级要求。

## 范围

本阶段包含：

- 开放注册。
- 密码登录。
- 签发 Access Token 和 Refresh Token。
- Refresh Token 轮换。
- 退出当前会话。
- 当前用户接口。
- Redis 保存 Refresh Token 状态。
- Redis 保存登录失败保护状态。
- 新用户默认 `练气` 角色。
- `admin` 超级管理员支持。
- 后续模块可复用的角色等级权限工具。
- 前端登录和注册页面接入真实接口。
- 登录后在工作台展示当前身份。

本阶段不包含：

- 邮箱验证。
- 邮箱找回密码。
- 完整用户管理页面。
- 角色分配界面。
- 导航、页面、工具、服务器入口 CRUD。
- 第三方 OAuth 登录。
- 两步验证。
- 长期操作日志界面。

## 架构

API 继续使用 NestJS。认证逻辑放在 `AuthModule`；用户查询和后续用户管理能力放在 `UsersModule`；角色数据继续放在 `RolesModule`；Prisma 访问继续通过 `PrismaService`。

前端继续使用 Next.js。登录页和注册页通过类型清晰的 API helper 调用后端。第一版中，浏览器保存短期 Access Token 到客户端状态或 Web Storage；当 API 和浏览器部署形态允许时，Refresh Token 使用 HTTP-only Cookie。如果本地开发不方便稳定使用安全 Cookie，实现可以临时使用显式 Refresh Token 请求体，但 API 设计必须保持 Refresh Token 存储方式可替换。

Redis 只保存短期安全状态。MySQL 仍然是用户、角色和用户状态的事实来源。

## 数据库模型

扩展 Prisma schema，新增 `User` 模型：

- `id`：整数主键。
- `username`：唯一字符串，长度 3 到 32。
- `email`：唯一字符串，统一转小写。
- `passwordHash`：密码哈希，绝不保存明文。
- `roleId`：必填角色关联。
- `isSuperAdmin`：布尔值，默认 `false`。
- `status`：枚举，包含 `active` 和 `disabled`。
- `lastLoginAt`：可为空时间。
- `createdAt`：创建时间。
- `updatedAt`：更新时间。

扩展 `Role`，增加 `users` 关联。现有九个初始化角色继续作为可分配角色集合。新用户默认使用 `qi_refining`（`练气`，等级 10）。

`admin` 账号通过 `isSuperAdmin = true` 标记。它也应该拥有 `administrator` 角色以保持数据一致，但超级管理员权限不依赖角色等级。

## Redis 状态

Redis key：

- `refresh_token:{tokenId}`：保存用户 id、Refresh Token 哈希、签发时间、过期时间，以及必要时的吊销标记。
- `user_sessions:{userId}`：保存该用户有效 token id 集合。
- `login_fail:{username}:{ip}`：带 TTL 的登录失败计数。

Refresh Token 规则：

- Refresh Token 是随机不透明字符串。
- Redis 只保存 Refresh Token 哈希。
- 刷新时使旧 token id 失效，并创建新的 token id。
- 退出登录时删除当前 Refresh Token 会话，并从用户会话集合移除。
- 禁用用户不能刷新会话。

登录失败规则：

- 登录失败会增加 `login_fail:{username}:{ip}`。
- 十五分钟内失败五次后，暂时阻止该用户名和 IP 继续登录，直到 TTL 过期。
- 登录成功会清理失败计数。

## API 契约

API 基础路径沿用当前服务根路径。

接口：

- `POST /auth/register`
  - 输入：`username`、`email`、`password`。
  - 输出：用户摘要、Access Token、Refresh Token 或 Refresh Cookie 元信息。
  - 行为：创建 active 用户，默认角色为 `qi_refining`。

- `POST /auth/login`
  - 输入：`account`、`password`，其中 account 可以是用户名或邮箱。
  - 输出：用户摘要、Access Token、Refresh Token 或 Refresh Cookie 元信息。
  - 行为：拒绝禁用用户和错误凭据。

- `POST /auth/refresh`
  - 输入：从 Cookie 或请求体读取 Refresh Token，取决于部署模式。
  - 输出：新的 Access Token 和轮换后的 Refresh Token。
  - 行为：拒绝缺失、过期、已吊销或哈希不匹配的 Refresh Token。

- `POST /auth/logout`
  - 认证：需要 Refresh Token。
  - 输出：成功标记。
  - 行为：删除当前 Refresh Token 会话。

- `GET /auth/me`
  - 认证：需要 Access Token。
  - 输出：当前用户摘要，包含角色 code、角色名称、角色等级和 `isSuperAdmin`。

用户摘要字段：

- `id`
- `username`
- `email`
- `status`
- `isSuperAdmin`
- `role.code`
- `role.name`
- `role.level`

## 权限规则

后端需要提供可复用权限工具：

- `isAuthenticated(user)`：有效 Access Token 能解析出 active 用户时为 true。
- `isSuperAdmin(user)`：`isSuperAdmin` 为 true 时为 true。
- `hasRoleLevel(user, minLevel)`：超级管理员直接通过；普通 active 用户角色等级大于等于 `minLevel` 时通过。
- `canViewServerEntries(user)`：超级管理员或角色等级至少 90 时通过。
- `canManageServerEntries(user)`：只有超级管理员通过。

前端可以隐藏不可用入口，但后端 guard 才是最终权限判断。

## 前端行为

登录页：

- 输入账号和密码。
- 对必填项做字段级校验。
- 调用 `POST /auth/login`。
- 通过本地 auth helper 保存返回的 Access Token。
- 登录成功后跳转到 `/dashboard`。
- 对凭据错误或临时锁定展示简洁错误。

注册页：

- 输入用户名、邮箱、密码和确认密码。
- 前端校验两次密码是否一致。
- 调用 `POST /auth/register`。
- 注册成功后自动进入登录状态。
- 跳转到 `/dashboard`。

工作台：

- 调用 `GET /auth/me`。
- 展示用户名、角色名称、角色等级和是否超级管理员。
- 提供退出登录动作。
- 本阶段暂不暴露服务器入口配置。

## 错误处理

API 校验错误应使用稳定消息和 HTTP 状态码：

- `400`：请求体不合法。
- `401`：凭据错误、缺少 token、token 过期或 token 无效。
- `403`：用户被禁用、临时锁定或权限不足。
- `409`：用户名或邮箱已存在。

前端展示面向人的错误消息，不应在登录错误中额外泄露账号是否存在。注册时的唯一性错误可以明确提示。

## 安全说明

- 密码必须使用 Argon2id 或 bcrypt 的当前安全默认参数进行哈希。
- 明文密码和明文 Refresh Token 不得保存到 MySQL 或 Redis。
- JWT 签名密钥来自 `.env`。
- Refresh Token 哈希密钥或盐来自 `.env`。
- `.env` 继续不进入 git。
- 文档和对话中不写入密钥。
- 生产环境 CORS 只允许配置好的前端来源。

## 测试策略

后端测试覆盖：

- 注册会创建默认 `qi_refining` 角色用户。
- 重复用户名或邮箱会被拒绝。
- 可以使用用户名或邮箱登录。
- 密码错误会被拒绝。
- 禁用用户不能登录或刷新。
- Refresh Token 刷新会轮换 token 状态。
- 退出登录会移除当前 Refresh Token 状态。
- `/auth/me` 返回当前用户和角色字段。
- 权限工具允许超级管理员、允许满足等级的角色、拒绝等级不足的角色。
- 登录失败保护会阻止连续失败请求。

前端验证覆盖：

- TypeScript build。
- ESLint。
- API 实现后的手动浏览器流程：注册、工作台身份展示、退出、再次登录。

## 部署说明

Docker Compose 已经包含 MySQL 和 Redis。本阶段需要这些环境变量：

- `JWT_ACCESS_SECRET`
- `JWT_ACCESS_EXPIRES_IN`
- `REFRESH_TOKEN_SECRET`
- `REFRESH_TOKEN_EXPIRES_IN_DAYS`
- 使用 Cookie 模式时需要 `COOKIE_SECRET`。
- `WEB_ORIGIN`

第一个超级管理员账号应在后续 admin bootstrap 任务中通过一次性命令创建。如果本阶段需要测试 admin，只能在测试 setup 或 seed 脚本中创建，不能把凭据硬编码进源码。

## 验收标准

- 新用户可以注册，并获得 `练气` 角色。
- 已注册用户可以登录、刷新、退出，并访问 `/auth/me`。
- 禁用用户会被受保护认证流程拒绝。
- Refresh Token 以哈希形式保存在 Redis，并在刷新时轮换。
- 连续登录失败会被临时阻止。
- 权限工具可以被后续内容模块复用。
- 登录页和注册页使用真实 API 调用。
- 项目仍然通过 API 测试、API lint、Web lint 和生产构建。
