# 个人门户平台设计

日期：2026-07-09

## 目标

将 `5200918.xyz` 建设成一个个人门户平台。未登录用户看到干净的公开主页、公开导航和公开页面；登录后，用户根据自己的角色看到对应的工作台、私有导航、可访问页面、工具和服务器入口。

第一版不是做一个一次性的导航页，而是搭好一个能长期扩展的基础平台。它需要支持开放注册、角色分配、公开/私有内容、后续自定义页面和自定义工具。

## 产品形态

站点采用公开区和登录区混合模式：

- 公开模式：首页、公开导航、公开页面、公开工具入口。
- 登录模式：个人工作台、按角色展示的内容、私有链接、可用工具。
- 管理模式：用户、角色、分类、链接、页面、工具、服务器入口、站点配置等管理页面。

第一版优先做好后台管理和导航入口。Markdown 页面和工具箱先做基础能力，为后续功能扩展预留结构。

## 技术栈

- 前端：Next.js、TypeScript、Tailwind CSS、shadcn/ui。
- 后端：NestJS、TypeScript。
- 数据库：MySQL 8.4 LTS。
- ORM 和数据库迁移：Prisma。
- 会话和限流状态：Redis。
- 部署：Docker Compose。
- 反向代理：Nginx 或 Caddy。

端口规划：

- `80`：HTTP，跳转到 HTTPS。
- `443`：网站 HTTPS。
- `8443`：Shadowsocks 代理节点。
- `8388`：旧 Shadowsocks 节点，暂时保留。

## 服务组成

部署时包含这些容器：

- `portal-frontend`：Next.js 前端应用。
- `portal-backend`：NestJS API 服务。
- `portal-mysql`：MySQL 8.4 LTS。
- `portal-redis`：Redis，用于认证、会话和限流状态。
- `portal-proxy`：可选的 Nginx/Caddy 反向代理。如果使用宿主机已有反代，也可以不单独起这个容器。

1Panel 可以用来管理容器和备份，但应用本身应该通过源码和 Docker Compose 保持可重复部署。

## 权限模型

权限分成两个概念：系统超级管理员标记和角色等级。

`admin` 账号是系统超级管理员。它可以配置所有内容、分配角色、禁用用户、管理服务器入口。

可分配角色如下：

| 角色 | 等级 |
| --- | ---: |
| 练气 | 10 |
| 筑基 | 20 |
| 金丹 | 30 |
| 元婴 | 40 |
| 化神 | 50 |
| 炼虚 | 60 |
| 合体 | 70 |
| 大乘 | 80 |
| 管理员 | 90 |

规则：

- 开放注册。
- 新注册用户默认角色为 `练气`。
- 只有 `admin` 可以分配或修改用户角色。
- `管理员` 角色可以查看服务器入口。
- 只有 `admin` 可以配置服务器入口。
- `admin` 跳过角色等级检查，拥有最高权限。

## 内容可见性

资源同时使用可见性和最低角色等级控制：

- `public`：所有人可见。
- `private`：需要登录，并且用户角色等级需要满足 `min_role_level`。

示例：

- 公开导航：`visibility = public`，`min_role_level = null`。
- 登录后可见内容：`visibility = private`，`min_role_level = 10`。
- 金丹以上可见内容：`visibility = private`，`min_role_level = 30`。
- 服务器入口：`visibility = private`，`min_role_level = 90`，并且只有 `admin` 可以配置。

用户自己的私有内容可以使用 `owner_id` 表示归属。MVP 中，后台创建的资源可以暂时不强调 owner 逻辑，但数据库字段需要保留，方便后续做个人私有内容。

## 页面路由

公开前端路由：

- `/`：公开首页。
- `/nav`：公开导航。
- `/pages/[slug]`：公开或有权限访问的页面详情。
- `/tools`：公开工具目录。
- `/login`：登录页。
- `/register`：注册页。

登录后路由：

- `/dashboard`：按角色展示的工作台。
- `/dashboard/nav`：用户可见的导航。
- `/dashboard/pages`：用户可见的页面。
- `/dashboard/tools`：用户可见的工具。
- `/dashboard/servers`：服务器入口，仅 `admin` 和角色 `管理员` 可见。

管理后台路由：

- `/admin/users`：用户列表、角色分配、用户状态管理。
- `/admin/categories`：分类管理。
- `/admin/links`：链接管理。
- `/admin/pages`：Markdown 页面管理。
- `/admin/tools`：工具入口管理。
- `/admin/servers`：服务器入口管理，仅 `admin` 可配置。
- `/admin/settings`：站点配置。

## 数据库模型

核心表：

- `users`
- `roles`
- `categories`
- `links`
- `pages`
- `tools`
- `server_entries`
- `settings`
- `operation_logs`

建议字段如下。

`users`

- `id`
- `username`
- `email`
- `password_hash`
- `role_id`
- `is_super_admin`
- `status`：`active`、`disabled`
- `created_at`
- `updated_at`
- `last_login_at`

`roles`

- `id`
- `code`
- `name`
- `level`
- `sort_order`

初始化时写入前面列出的九个可分配角色。

`categories`

- `id`
- `name`
- `slug`
- `type`：`link`、`page`、`tool`、`server`
- `visibility`：`public`、`private`
- `min_role_level`
- `owner_id`
- `sort_order`
- `is_enabled`
- `created_at`
- `updated_at`

`links`

- `id`
- `category_id`
- `title`
- `url`
- `description`
- `icon`
- `visibility`
- `min_role_level`
- `owner_id`
- `sort_order`
- `is_enabled`
- `created_at`
- `updated_at`

`pages`

- `id`
- `title`
- `slug`
- `summary`
- `content_markdown`
- `visibility`
- `min_role_level`
- `owner_id`
- `is_published`
- `published_at`
- `created_at`
- `updated_at`

`tools`

- `id`
- `name`
- `slug`
- `description`
- `icon`
- `entry_path`
- `visibility`
- `min_role_level`
- `is_enabled`
- `created_at`
- `updated_at`

`server_entries`

- `id`
- `name`
- `entry_url`
- `description`
- `host`
- `port`
- `protocol`
- `visibility`
- `min_role_level`
- `sort_order`
- `is_enabled`
- `created_at`
- `updated_at`

服务器入口表不存密码、私钥、代理密码等敏感信息。密钥类内容继续保存在本地秘密文件中，或者以后接入专门的密钥管理方案。

`settings`

- `id`
- `key`
- `value`
- `value_type`
- `updated_at`

`operation_logs`

- `id`
- `actor_user_id`
- `action`
- `resource_type`
- `resource_id`
- `ip`
- `user_agent`
- `created_at`

## Redis 设计

Redis 只存短期认证和安全状态，不作为业务数据的事实来源。

Key 设计：

- `refresh_token:{token_id}`：保存 refresh token 的 hash、用户 id、过期信息。
- `user_sessions:{user_id}`：保存某个用户的有效 token id 集合。
- `login_fail:{username}:{ip}`：登录失败计数，带 TTL。
- `rate_limit:{ip}:{route}`：接口限流计数，带 TTL。

认证规则：

- Access Token：短期 JWT，约 15 分钟。
- Refresh Token：长随机字符串，约 7 到 30 天。
- Redis 里只保存 Refresh Token 的 hash，不保存明文。
- 退出登录时删除当前 token id。
- 修改密码时删除该用户全部 token id。
- 用户被禁用时删除该用户全部 token id。
- 登录失败次数过多时临时阻止继续登录。

## API 边界

后端模块：

- `AuthModule`：注册、登录、刷新 token、退出登录、密码哈希、Redis token 状态。
- `UsersModule`：用户列表、角色分配、用户状态修改。
- `RolesModule`：角色初始化、角色查询。
- `CategoriesModule`：分类 CRUD 和权限过滤。
- `LinksModule`：链接 CRUD 和可见链接查询。
- `PagesModule`：Markdown 页面 CRUD 和页面展示数据。
- `ToolsModule`：工具入口 CRUD 和可见工具查询。
- `ServerEntriesModule`：服务器入口 CRUD，管理权限限制为 `admin`。
- `SettingsModule`：站点配置。
- `AuditModule`：操作日志。

前端只调用后端 API，不直接读取数据库。

## MVP 范围

MVP 包含：

- 开放注册，新用户默认 `练气`。
- 登录、退出登录、刷新 token、基础登录失败保护。
- admin 用户管理和角色分配。
- 分类管理。
- 链接管理。
- 根据角色展示公开和私有导航。
- 基础 Markdown 页面管理。
- 基础工具入口管理。
- 服务器入口展示，仅 `admin` 和角色 `管理员` 可见。
- 服务器入口配置，仅 `admin` 可操作。
- 重要后台操作写入操作日志。

MVP 不包含：

- 邮箱验证。
- 邮箱找回密码。
- 评论。
- 全站搜索。
- 用户组。
- 插件市场。
- 复杂工具运行沙箱。
- Redis 业务缓存。

## 安全说明

- 密码使用强哈希存储，不保存明文。
- Refresh Token 只保存 hash，不保存明文。
- 服务器入口不保存密码、私钥或代理密钥。
- 后台路由必须由后端做权限校验，不能只依赖前端隐藏。
- 所有受保护接口都要做角色校验。
- 登录失败限制使用 Redis。
- 网站使用 `443` HTTPS。
- 1Panel 继续保留现有额外保护，不应在公开页面直接暴露管理入口。

## 部署说明

使用 Docker Compose 保持部署可重复。`.env` 不进入 git，生成的密钥保存在本地秘密文件中。

初始部署流程：

1. 启动 MySQL 和 Redis。
2. 执行 Prisma migrations 并初始化角色数据。
3. 通过一次性 bootstrap 命令创建第一个 `admin` 用户。
4. 启动后端服务。
5. 启动前端服务。
6. 配置 Nginx/Caddy，绑定 `5200918.xyz` 或 `www.5200918.xyz`。
7. 验证 HTTPS、登录、角色过滤和后台路由。

## 待确认决策

- 公开网站使用根域名 `5200918.xyz` 还是 `www.5200918.xyz`。
- 反向代理使用 Nginx 还是 Caddy。
- 第一个 admin 用户通过 CLI bootstrap 创建，还是通过环境变量创建。

默认建议：

- 如果根域名后续可能保留给其他用途，网站使用 `www.5200918.xyz`。
- 如果希望 HTTPS 最省心，优先使用 Caddy。
- 第一个 `admin` 使用一次性后端 bootstrap 命令创建。

