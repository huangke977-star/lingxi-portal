# Lingxi Portal

灵犀门户是一个个人门户平台项目。

## 技术栈

- Frontend: Next.js + TypeScript
- Backend: NestJS + TypeScript
- Database: MySQL 8.4 LTS
- ORM: Prisma
- Session state: Redis
- Deployment: Docker Compose

## 本地开发

```bash
pnpm install
cp .env.example .env
docker compose up -d mysql redis
pnpm --filter @lingxi/api prisma:generate
pnpm --filter @lingxi/api prisma:migrate
pnpm --filter @lingxi/api prisma:seed
pnpm dev
```

## 设计文档

- `docs/superpowers/specs/2026-07-09-personal-portal-design.zh-CN.md`
- `docs/superpowers/specs/2026-07-09-personal-portal-design.md`
