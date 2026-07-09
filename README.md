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

## Docker 全栈 / Docker Stack

```bash
docker compose up -d --build
```

MySQL and Redis are internal Compose dependencies and are not published to host ports. API and web are exposed through `API_PORT` and `WEB_PORT`.

MySQL 和 Redis 只作为 Compose 内部依赖使用，不映射到宿主机端口。API 和 Web 通过 `API_PORT` 与 `WEB_PORT` 对外访问。

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
- `docs/superpowers/plans/2026-07-09-project-foundation.zh-CN.md`
- `docs/superpowers/plans/2026-07-09-project-foundation.md`
