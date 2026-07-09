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
docker compose run --rm -e ADMIN_USERNAME -e ADMIN_EMAIL -e ADMIN_PASSWORD api sh -c "cd apps/api && pnpm admin:bootstrap:prod"
```

The command is idempotent: if the username or email already exists, it updates that account to `isSuperAdmin=true`, assigns the `administrator` role, activates it, and replaces the password hash. It does not print the password.

该命令是幂等的：如果用户名或邮箱已存在，会把该账号更新为 `isSuperAdmin=true`，分配 `administrator` 角色，启用账号，并替换密码哈希。命令不会打印密码。

## Docker 全栈 / Docker Stack

```bash
docker compose up -d --build
```

The `api-bootstrap` service runs Prisma migrations and role seed data before the API starts. MySQL and Redis are internal Compose dependencies and are not published to host ports. API and web are exposed through `API_PORT` and `WEB_PORT`.

`api-bootstrap` 服务会在 API 启动前执行 Prisma 迁移和角色种子数据。MySQL 和 Redis 只作为 Compose 内部依赖使用，不映射到宿主机端口。API 和 Web 通过 `API_PORT` 与 `WEB_PORT` 对外访问。

The localhost database URLs in `.env.example` are for host-native development. Docker Compose overrides them with internal service URLs.

`.env.example` 中的 localhost 数据库地址用于宿主机本地开发；Docker Compose 会在容器内覆盖为内部服务地址。

Set `NEXT_PUBLIC_API_BASE_URL` to the browser-reachable API URL before building the web image, for example `http://5200918.xyz:3001` for direct port testing or your later reverse-proxy API path.

构建 Web 镜像前，要把 `NEXT_PUBLIC_API_BASE_URL` 设置为浏览器可访问的 API 地址，例如直接端口测试时使用 `http://5200918.xyz:3001`，后续接入反向代理时改为你的 API 路径。

For small VPS deployments, prefer the production compose file. It pulls prebuilt images from GHCR and avoids building Docker images on the server.

小型 VPS 部署建议使用生产 compose 文件。它从 GHCR 拉取预构建镜像，避免在服务器本机执行 Docker 构建。

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

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
