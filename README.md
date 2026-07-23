# Lingxi Portal

灵犀门户是一个个人门户平台项目。  
Lingxi Portal is a personal portal platform.

## 技术栈 / Tech Stack

- Frontend: Next.js + TypeScript
- Backend: NestJS + TypeScript
- Database: MySQL 8.4 LTS
- ORM: Prisma
- Session state: Redis
- Deployment: Docker Compose

## 本地开发 / Local Development

```bash
pnpm install
cp .env.example .env
pnpm --filter @lingxi/api prisma:generate
pnpm --filter @lingxi/api test
pnpm --filter @lingxi/web build
pnpm dev
```

Windows PowerShell can use:

```powershell
Copy-Item .env.example .env
```

## 认证环境 / Auth Environment

认证阶段需要在本地 `.env` 中配置这些变量。不要提交真实密钥。

The auth phase needs these local variables in `.env`. Do not commit real secrets.

- `JWT_ACCESS_SECRET`
- `JWT_ACCESS_EXPIRES_IN`
- `REFRESH_TOKEN_SECRET`
- `REFRESH_TOKEN_EXPIRES_IN_DAYS`
- `MAX_REFRESH_SESSIONS_PER_USER`（默认 `10`）

## 超级管理员初始化 / Super Admin Bootstrap

先执行 Prisma 迁移和角色种子数据，再用环境变量创建第一个超级管理员账号。真实账号和密码只放在私有 `.env` 或服务器环境变量中，不要提交到仓库。

Run Prisma migrations and role seed data first, then create the first super-admin account from environment variables. Keep real usernames and passwords only in private `.env` files or server environment variables; do not commit them.

Required variables:

- `ADMIN_USERNAME`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

Local command:

```bash
pnpm --filter @lingxi/api admin:bootstrap
```

Docker command:

```bash
docker compose run --rm -e ADMIN_USERNAME -e ADMIN_EMAIL -e ADMIN_PASSWORD api sh -c "node apps/api/dist/prisma/bootstrap-admin.js"
```

The command is idempotent: if the username or email already exists, it updates that account to `isSuperAdmin=true`, assigns the `administrator` role, activates it, and replaces the password hash. It does not print the password.

该命令是幂等的：如果用户名或邮箱已存在，会把该账号更新为 `isSuperAdmin=true`，分配 `administrator` 角色，启用账号，并替换密码哈希。命令不会打印密码。

## 全站背景管理 / Global Background Management

超级管理员可以通过头像菜单或 `/admin/backgrounds` 上传、切换和永久删除全站背景图片。当前选中的图片对所有用户生效，个人主题只控制配色、卡片透明度和磨砂程度。删除正在使用的图片后，门户会恢复内置默认背景。

Super administrators can upload, activate, and permanently delete global background images from the avatar menu or `/admin/backgrounds`. The selected image applies to every user, while personal themes only control colors, card transparency, and glass blur. Deleting the active upload restores the bundled default background.

- Accepted formats: JPEG, PNG, WebP, AVIF
- Maximum size: 30 MB per image
- Batch upload: up to 20 images at once
- Metadata: MySQL `background_images` table
- File storage: `background_uploads` Docker volume mounted at `/app/uploads/backgrounds`
- Public delivery: `/api/backgrounds/files/:storedName`

The API validates the declared MIME type, file extension, and binary image signature. Stored filenames are randomized. Deleting an image removes both its database record and physical file.

API 会同时校验 MIME 类型、扩展名和图片二进制签名，磁盘文件名使用随机值。删除图片时会同时删除数据库记录和真实磁盘文件。

## 账号外观与头像 / Account Appearance And Avatar

用户可以在 `/profile` 保存账号级外观设置，包括主题、卡片透明度、磨砂程度、磨砂颜色、磨砂透明度和自定义配色。头像支持 JPEG、PNG、WebP，单张最大 2 MB，文件存储在 `avatar_uploads` Docker 命名卷中。

Users can save account-level appearance settings at `/profile`, including theme, card transparency, glass blur, glass tint, glass tint opacity, and custom colors. Avatars support JPEG, PNG, and WebP up to 2 MB per file, stored in the `avatar_uploads` Docker named volume.

## Redis 缓存管理 / Redis Cache Management

超级管理员可以通过头像菜单或 `/admin/cache` 查看 Redis 状态、使用游标搜索缓存键、检查脱敏后的键值，并安全撤销登录会话或清除登录失败计数。管理员角色无权访问。页面不提供任意 Redis 命令、`KEYS *` 或清库功能，Redis 仍只存在于 Docker 内部网络。

Super administrators can use the avatar menu or `/admin/cache` to inspect Redis metrics, browse keys with cursor-based scans, view redacted values, revoke login sessions, and clear login failure counters. Administrator-role users are denied. The page exposes no arbitrary Redis commands, `KEYS *`, or database flush actions, and Redis remains internal to the Docker network.

## 登录续期与设备管理 / Session Renewal And Device Management

登录后的 Access Token 会在到期前自动续期，受保护接口遇到 `401` 时也会刷新并重试一次。普通 `403` 权限错误不会清除登录状态。个人中心的“登录设备”区域可查看当前账号的有效会话，并支持退出其他设备或退出全部设备。每个账号默认最多保留 10 个 Refresh Token 会话，超出时自动撤销较旧会话。

Access tokens renew automatically before expiry, and protected requests retry once after a `401` refresh. Ordinary `403` permission errors do not clear the login state. The Login Sessions panel in `/profile` lists active account sessions and can revoke other devices or every device. Each account keeps at most 10 refresh-token sessions by default; older sessions are revoked automatically.

Authentication cache TTL values are controlled by the access/refresh-token policy and cannot be edited from cache management. This keeps token records and user-session indexes consistent. Revoking a Refresh Token does not retroactively invalidate an already issued Access Token, which can remain valid until its short expiry time.

认证缓存的 TTL 由 Access Token / Refresh Token 策略统一控制，缓存管理页不能手动修改，以保证令牌记录和用户会话索引一致。撤销 Refresh Token 后，已经签发的短期 Access Token 不会被追溯失效，最迟会在自身到期时停止使用。

## Docker 全栈 / Docker Stack

```bash
docker compose up -d --build
```

The `api-bootstrap` service runs Prisma migrations and role seed data before the API starts. MySQL and Redis are internal Compose dependencies and are not published to host ports. API and web are exposed through `API_PORT` and `WEB_PORT`.

`api-bootstrap` 服务会在 API 启动前执行 Prisma 迁移和角色种子数据。MySQL 和 Redis 只作为 Compose 内部依赖使用，不映射到宿主机端口。API 和 Web 通过 `API_PORT` 与 `WEB_PORT` 对外访问。

The localhost database URLs in `.env.example` are for host-native development. Docker Compose overrides them with internal service URLs.

`.env.example` 中的 localhost 数据库地址用于宿主机本地开发；Docker Compose 会在容器内覆盖为内部服务地址。

The named `background_uploads` volume survives normal container recreation. Do not run `docker compose down -v` unless you intentionally want to remove uploaded backgrounds together with the other named volumes.

命名卷 `background_uploads` 会在普通容器重建后继续保留。除非你确认要连同其他命名卷一起删除已上传背景，否则不要执行 `docker compose down -v`。

The named `avatar_uploads` volume stores user avatars and should also be preserved during deployment.

命名卷 `avatar_uploads` 保存用户头像，部署时同样需要保留。

The `article_uploads` and `chat_uploads` volumes store article media and authenticated chat attachments. Preserve both volumes during deployment; attachment records in MySQL are not substitutes for the files themselves.

命名卷 `article_uploads` 和 `chat_uploads` 分别保存文章媒体与需要登录鉴权的聊天附件。部署时必须保留这两个卷；MySQL 中的附件记录不能替代实际文件。

Set `NEXT_PUBLIC_API_BASE_URL` to the browser-reachable API URL before building the web image, for example `http://5200918.xyz:3001` for direct port testing or your later reverse-proxy API path.

构建 Web 镜像前，要把 `NEXT_PUBLIC_API_BASE_URL` 设置为浏览器可访问的 API 地址，例如直接端口测试时使用 `http://5200918.xyz:3001`，后续接入反向代理时改为你的 API 路径。

For small VPS deployments, prefer the production compose file. It pulls prebuilt images from GHCR and avoids building Docker images on the server.

小型 VPS 部署建议使用生产 compose 文件。它从 GHCR 拉取预构建镜像，避免在服务器本机执行 Docker 构建。

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Production traffic should enter through Caddy:

- Web: `https://5200918.xyz`
- Login: `https://5200918.xyz/login`
- API through reverse proxy: `https://5200918.xyz/api`

生产流量应通过 Caddy 进入：

- Web：`https://5200918.xyz`
- 登录：`https://5200918.xyz/login`
- API 反向代理：`https://5200918.xyz/api`

After Caddy is verified, keep only TCP `80` and `443` open to the public. The app containers bind `3000` and `3001` to `127.0.0.1` only.

Caddy 验证通过后，公网只保留 TCP `80` 和 `443`。应用容器的 `3000` 和 `3001` 只绑定到服务器本机 `127.0.0.1`。

## 验证 / Verification

```bash
pnpm --filter @lingxi/api prisma:generate
pnpm --filter @lingxi/api test
pnpm --filter @lingxi/api lint
pnpm --filter @lingxi/web lint
pnpm build
```

## 文档 / Documentation

- `docs/superpowers/specs/2026-07-09-personal-portal-design.zh-CN.md`
- `docs/superpowers/specs/2026-07-09-personal-portal-design.md`
- `docs/superpowers/specs/2026-07-09-auth-rbac-design.zh-CN.md`
- `docs/superpowers/specs/2026-07-09-auth-rbac-design.md`
- `docs/superpowers/specs/2026-07-09-admin-bootstrap-users-design.zh-CN.md`
- `docs/superpowers/specs/2026-07-09-admin-bootstrap-users-design.md`
- `docs/superpowers/plans/2026-07-09-project-foundation.zh-CN.md`
- `docs/superpowers/plans/2026-07-09-project-foundation.md`
- `docs/superpowers/plans/2026-07-09-auth-rbac-foundation.zh-CN.md`
- `docs/superpowers/plans/2026-07-09-auth-rbac-foundation.md`
- `docs/superpowers/plans/2026-07-09-admin-bootstrap-users.zh-CN.md`
- `docs/superpowers/plans/2026-07-09-admin-bootstrap-users.md`
- `docs/superpowers/specs/2026-07-13-global-background-management.zh-CN.md`
- `docs/superpowers/specs/2026-07-13-global-background-management.md`
- `docs/superpowers/specs/2026-07-14-account-appearance-profile.zh-CN.md`
- `docs/superpowers/specs/2026-07-14-account-appearance-profile.md`
- `docs/superpowers/specs/2026-07-16-session-renewal-and-management.zh-CN.md`
- `docs/superpowers/specs/2026-07-16-session-renewal-and-management.md`
