# Lingxi Portal Project Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the initial Lingxi Portal project foundation: monorepo, frontend scaffold, backend scaffold, MySQL, Redis, Prisma seed roles, and a local Docker-based development environment.

**Architecture:** This phase creates a TypeScript monorepo with separate frontend and backend apps. The backend owns database access through Prisma and exposes health/role endpoints; the frontend is a Next.js app that can call the backend. MySQL stores durable business data and Redis stores short-lived auth/security state in later phases.

**Tech Stack:** Next.js, NestJS, TypeScript, Prisma, MySQL 8.4 LTS, Redis, Docker Compose, pnpm.

## Global Constraints

- Keep frontend and backend separated under `apps/web` and `apps/api`.
- Use MySQL for durable data and Redis for short-lived session/security state.
- Seed assignable roles: `练气`, `筑基`, `金丹`, `元婴`, `化神`, `炼虚`, `合体`, `大乘`, `管理员`.
- New users will default to `练气` in later auth work; this phase only seeds roles.
- Do not store passwords, private keys, proxy passwords, or server secrets in the project repository.
- Keep `.env` out of git; commit only `.env.example`.
- Use `443` for the future website and keep proxy node on `8443`.
- This is Phase 1 only. Auth, full CRUD, admin UI, and deployment to the VPS are planned in later phases.

---

## Scope Check

The full product spec covers multiple subsystems: auth, role permissions, navigation management, Markdown pages, tools, server entries, deployment, and security controls. This plan intentionally implements only the foundation needed by later plans. A successful completion gives us a runnable local stack, seeded roles, backend health endpoints, and a frontend shell.

## Target File Structure

Create this structure:

```text
lingxi-portal/
  .editorconfig
  .env.example
  .gitattributes
  .gitignore
  README.md
  docker-compose.yml
  package.json
  pnpm-workspace.yaml
  apps/
    api/
      Dockerfile
      package.json
      prisma/
        schema.prisma
        seed.ts
      src/
        app.module.ts
        main.ts
        health/
          health.controller.ts
          health.module.ts
        roles/
          roles.controller.ts
          roles.module.ts
          roles.service.ts
      test/
        health.e2e-spec.ts
        roles.e2e-spec.ts
    web/
      Dockerfile
      package.json
      src/
        app/
          page.tsx
          nav/page.tsx
          login/page.tsx
          register/page.tsx
          dashboard/page.tsx
          admin/page.tsx
        lib/
          api.ts
  docs/
    superpowers/
      specs/
      plans/
```

Responsibilities:

- Root files define workspace, shared commands, env examples, Docker Compose, and cross-platform text handling.
- `apps/api` is the NestJS backend and the only app that talks to MySQL/Redis directly.
- `apps/web` is the Next.js frontend and talks to the backend through HTTP.
- `apps/api/prisma` owns schema, migrations, and seed data.

---

### Task 1: Workspace Baseline

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.editorconfig`
- Create: `.gitattributes`
- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:**
- Produces root commands used by later tasks: `pnpm lint`, `pnpm test`, `pnpm dev`, `pnpm build`.
- Produces workspace package names expected later: `@lingxi/api` and `@lingxi/web`.

- [ ] **Step 1: Add workspace package manifest**

Create `package.json`:

```json
{
  "name": "lingxi-portal",
  "private": true,
  "version": "0.1.0",
  "description": "Lingxi Portal personal portal platform",
  "packageManager": "pnpm@latest",
  "scripts": {
    "dev": "pnpm --parallel --filter @lingxi/api --filter @lingxi/web dev",
    "build": "pnpm --filter @lingxi/api build && pnpm --filter @lingxi/web build",
    "lint": "pnpm --filter @lingxi/api lint && pnpm --filter @lingxi/web lint",
    "test": "pnpm --filter @lingxi/api test",
    "format": "pnpm --filter @lingxi/api format && pnpm --filter @lingxi/web format"
  }
}
```

- [ ] **Step 2: Add pnpm workspace config**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
```

- [ ] **Step 3: Add editor config**

Create `.editorconfig`:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 4: Add git attributes**

Create `.gitattributes`:

```gitattributes
* text=auto eol=lf
*.bat text eol=crlf
*.cmd text eol=crlf
*.ps1 text eol=crlf
```

- [ ] **Step 5: Extend gitignore**

Modify `.gitignore` so it contains:

```gitignore
# dependencies
node_modules/
.pnpm-store/

# builds
.next/
dist/
build/
coverage/

# env
.env
.env.*
!.env.example

# logs
*.log
npm-debug.log*
yarn-debug.log*
pnpm-debug.log*

# database and uploads
*.sqlite
*.sqlite3
uploads/

# system
.DS_Store
Thumbs.db

# local tooling
.turbo/
.cache/
```

- [ ] **Step 6: Update README with setup commands**

Replace `README.md` with:

```markdown
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
```

- [ ] **Step 7: Verify workspace files**

Run:

```bash
git status --short
```

Expected: new or modified root files are visible.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml .editorconfig .gitattributes .gitignore README.md
git commit -m "chore: set up workspace baseline"
```

---

### Task 2: Docker Infrastructure and Environment Template

**Files:**
- Create: `.env.example`
- Create: `docker-compose.yml`

**Interfaces:**
- Produces MySQL connection URL consumed by Prisma: `DATABASE_URL`.
- Produces Redis connection URL consumed by the backend: `REDIS_URL`.
- Produces backend base URL consumed by the frontend: `NEXT_PUBLIC_API_BASE_URL`.

- [ ] **Step 1: Add environment example**

Create `.env.example`:

```dotenv
COMPOSE_PROJECT_NAME=lingxi_portal

MYSQL_ROOT_PASSWORD=change-me-root-password
MYSQL_DATABASE=lingxi_portal
MYSQL_USER=lingxi
MYSQL_PASSWORD=change-me-app-password
MYSQL_PORT=3306

DATABASE_URL=mysql://lingxi:change-me-app-password@localhost:3306/lingxi_portal
REDIS_URL=redis://localhost:6379

API_PORT=3001
WEB_PORT=3000
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001

JWT_ACCESS_SECRET=change-me-access-secret
JWT_REFRESH_SECRET=change-me-refresh-secret
```

- [ ] **Step 2: Add Docker Compose**

Create `docker-compose.yml`:

```yaml
services:
  mysql:
    image: mysql:8.4
    container_name: lingxi-mysql
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: ${MYSQL_DATABASE}
      MYSQL_USER: ${MYSQL_USER}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
    ports:
      - "${MYSQL_PORT:-3306}:3306"
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -u root -p$${MYSQL_ROOT_PASSWORD} --silent"]
      interval: 10s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    container_name: lingxi-redis
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 10

volumes:
  mysql_data:
  redis_data:
```

- [ ] **Step 3: Create local env file**

Run:

```bash
cp .env.example .env
```

Expected: `.env` exists and remains untracked because of `.gitignore`.

- [ ] **Step 4: Validate Compose syntax**

Run:

```bash
docker compose config
```

Expected: command exits 0 and prints normalized compose config.

- [ ] **Step 5: Start MySQL and Redis**

Run:

```bash
docker compose up -d mysql redis
```

Expected: `lingxi-mysql` and `lingxi-redis` containers start.

- [ ] **Step 6: Verify service health**

Run:

```bash
docker compose ps
```

Expected: both services show as running, and health becomes `healthy` after startup.

- [ ] **Step 7: Commit**

```bash
git add .env.example docker-compose.yml
git commit -m "chore: add database and redis infrastructure"
```

---

### Task 3: Backend Scaffold with Health Endpoint

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/tsconfig.build.json`
- Create: `apps/api/nest-cli.json`
- Create: `apps/api/Dockerfile`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/health/health.module.ts`
- Create: `apps/api/src/health/health.controller.ts`
- Create: `apps/api/test/jest-e2e.json`
- Create: `apps/api/test/health.e2e-spec.ts`

**Interfaces:**
- Produces API app listening on `process.env.API_PORT || 3001`.
- Produces endpoint `GET /health` returning `{ "status": "ok", "service": "lingxi-api" }`.
- Later backend modules import into `AppModule`.

- [ ] **Step 1: Create backend package manifest**

Create `apps/api/package.json`:

```json
{
  "name": "@lingxi/api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch",
    "start": "node dist/main.js",
    "lint": "eslint \"src/**/*.ts\" \"test/**/*.ts\"",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "test": "jest --config test/jest-e2e.json",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "@nestjs/common": "latest",
    "@nestjs/core": "latest",
    "@nestjs/platform-express": "latest",
    "@prisma/client": "latest",
    "reflect-metadata": "latest",
    "rxjs": "latest"
  },
  "devDependencies": {
    "@nestjs/cli": "latest",
    "@nestjs/schematics": "latest",
    "@nestjs/testing": "latest",
    "@types/express": "latest",
    "@types/jest": "latest",
    "@types/node": "latest",
    "@typescript-eslint/eslint-plugin": "latest",
    "@typescript-eslint/parser": "latest",
    "eslint": "latest",
    "jest": "latest",
    "prettier": "latest",
    "prisma": "latest",
    "source-map-support": "latest",
    "supertest": "latest",
    "ts-jest": "latest",
    "ts-loader": "latest",
    "ts-node": "latest",
    "tsx": "latest",
    "typescript": "latest"
  }
}
```

- [ ] **Step 2: Add TypeScript configs**

Create `apps/api/tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2022",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "strict": true,
    "skipLibCheck": true
  }
}
```

Create `apps/api/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts"]
}
```

Create `apps/api/nest-cli.json`:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 3: Add backend application code**

Create `apps/api/src/main.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
}

void bootstrap();
```

Create `apps/api/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';

@Module({
  imports: [HealthModule],
})
export class AppModule {}
```

Create `apps/api/src/health/health.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```

Create `apps/api/src/health/health.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  getHealth() {
    return {
      status: 'ok',
      service: 'lingxi-api',
    };
  }
}
```

- [ ] **Step 4: Add backend Dockerfile**

Create `apps/api/Dockerfile`:

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --filter @lingxi/api... --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .
RUN pnpm --filter @lingxi/api build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json ./package.json
COPY --from=builder /app/apps/api/node_modules ./node_modules
EXPOSE 3001
CMD ["node", "dist/main.js"]
```

- [ ] **Step 5: Add health endpoint e2e test**

Create `apps/api/test/jest-e2e.json`:

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "..",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  }
}
```

Create `apps/api/test/health.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('HealthController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns service status', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({
        status: 'ok',
        service: 'lingxi-api',
      });
  });
});
```

- [ ] **Step 6: Install dependencies**

Run from repo root:

```bash
pnpm install
```

Expected: `pnpm-lock.yaml` is created.

- [ ] **Step 7: Run backend health test**

Run:

```bash
pnpm --filter @lingxi/api test -- health.e2e-spec.ts
```

Expected: PASS for `GET /health returns service status`.

- [ ] **Step 8: Commit**

```bash
git add apps/api package.json pnpm-lock.yaml
git commit -m "feat(api): add nest health scaffold"
```

---

### Task 4: Prisma Schema and Role Seed

**Files:**
- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/seed.ts`
- Create: `apps/api/src/roles/roles.module.ts`
- Create: `apps/api/src/roles/roles.service.ts`
- Create: `apps/api/src/roles/roles.controller.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/roles.e2e-spec.ts`

**Interfaces:**
- Produces Prisma model `Role` with fields `id`, `code`, `name`, `level`, `sortOrder`, `createdAt`, `updatedAt`.
- Produces endpoint `GET /roles` returning roles ordered by level ascending.
- Later auth work uses `Role.code === "qi_refining"` as the default role for new users.

- [ ] **Step 1: Add Prisma schema**

Create `apps/api/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model Role {
  id        Int      @id @default(autoincrement())
  code      String   @unique @db.VarChar(64)
  name      String   @db.VarChar(64)
  level     Int      @unique
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("roles")
}
```

- [ ] **Step 2: Add role seed script**

Create `apps/api/prisma/seed.ts`:

```ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const roles = [
  { code: 'qi_refining', name: '练气', level: 10, sortOrder: 10 },
  { code: 'foundation_building', name: '筑基', level: 20, sortOrder: 20 },
  { code: 'golden_core', name: '金丹', level: 30, sortOrder: 30 },
  { code: 'nascent_soul', name: '元婴', level: 40, sortOrder: 40 },
  { code: 'spirit_transformation', name: '化神', level: 50, sortOrder: 50 },
  { code: 'void_refining', name: '炼虚', level: 60, sortOrder: 60 },
  { code: 'body_integration', name: '合体', level: 70, sortOrder: 70 },
  { code: 'mahayana', name: '大乘', level: 80, sortOrder: 80 },
  { code: 'administrator', name: '管理员', level: 90, sortOrder: 90 },
];

async function main() {
  for (const role of roles) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: {
        name: role.name,
        level: role.level,
        sortOrder: role.sortOrder,
      },
      create: role,
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
```

- [ ] **Step 3: Generate Prisma client**

Run:

```bash
pnpm --filter @lingxi/api prisma:generate
```

Expected: Prisma client generation succeeds.

- [ ] **Step 4: Run migration**

Run:

```bash
pnpm --filter @lingxi/api prisma:migrate -- --name init_roles
```

Expected: migration creates `roles` table in MySQL.

- [ ] **Step 5: Seed roles**

Run:

```bash
pnpm --filter @lingxi/api prisma:seed
```

Expected: command exits 0 with no errors.

- [ ] **Step 6: Add roles module**

Create `apps/api/src/roles/roles.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class RolesService {
  private readonly prisma = new PrismaClient();

  async listRoles() {
    return this.prisma.role.findMany({
      orderBy: { level: 'asc' },
      select: {
        code: true,
        name: true,
        level: true,
      },
    });
  }
}
```

Create `apps/api/src/roles/roles.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { RolesService } from './roles.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  listRoles() {
    return this.rolesService.listRoles();
  }
}
```

Create `apps/api/src/roles/roles.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  controllers: [RolesController],
  providers: [RolesService],
})
export class RolesModule {}
```

Modify `apps/api/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { RolesModule } from './roles/roles.module';

@Module({
  imports: [HealthModule, RolesModule],
})
export class AppModule {}
```

- [ ] **Step 7: Add roles e2e test**

Create `apps/api/test/roles.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('RolesController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /roles returns seeded cultivation roles', async () => {
    const response = await request(app.getHttpServer()).get('/roles').expect(200);

    expect(response.body).toEqual([
      { code: 'qi_refining', name: '练气', level: 10 },
      { code: 'foundation_building', name: '筑基', level: 20 },
      { code: 'golden_core', name: '金丹', level: 30 },
      { code: 'nascent_soul', name: '元婴', level: 40 },
      { code: 'spirit_transformation', name: '化神', level: 50 },
      { code: 'void_refining', name: '炼虚', level: 60 },
      { code: 'body_integration', name: '合体', level: 70 },
      { code: 'mahayana', name: '大乘', level: 80 },
      { code: 'administrator', name: '管理员', level: 90 },
    ]);
  });
});
```

- [ ] **Step 8: Run roles test**

Run:

```bash
pnpm --filter @lingxi/api test -- roles.e2e-spec.ts
```

Expected: PASS for `GET /roles returns seeded cultivation roles`.

- [ ] **Step 9: Commit**

```bash
git add apps/api/prisma apps/api/src apps/api/test
git commit -m "feat(api): seed cultivation roles"
```

---

### Task 5: Frontend Scaffold and Public Shell

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/Dockerfile`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/nav/page.tsx`
- Create: `apps/web/src/app/login/page.tsx`
- Create: `apps/web/src/app/register/page.tsx`
- Create: `apps/web/src/app/dashboard/page.tsx`
- Create: `apps/web/src/app/admin/page.tsx`
- Create: `apps/web/src/lib/api.ts`

**Interfaces:**
- Produces frontend app `@lingxi/web` on port `3000`.
- Produces public shell routes matching the design document.
- Consumes backend base URL from `NEXT_PUBLIC_API_BASE_URL`.

- [ ] **Step 1: Create frontend package manifest**

Create `apps/web/package.json`:

```json
{
  "name": "@lingxi/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start --port 3000",
    "lint": "next lint",
    "format": "prettier --write \"src/**/*.{ts,tsx,css,md}\""
  },
  "dependencies": {
    "next": "latest",
    "react": "latest",
    "react-dom": "latest"
  },
  "devDependencies": {
    "@types/node": "latest",
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "eslint": "latest",
    "eslint-config-next": "latest",
    "prettier": "latest",
    "typescript": "latest"
  }
}
```

- [ ] **Step 2: Add Next.js config**

Create `apps/web/next.config.ts`:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
};

export default nextConfig;
```

Create `apps/web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Add frontend API helper**

Create `apps/web/src/lib/api.ts`:

```ts
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export async function getApiHealth() {
  const response = await fetch(`${API_BASE_URL}/health`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`API health check failed with status ${response.status}`);
  }

  return response.json() as Promise<{ status: string; service: string }>;
}
```

- [ ] **Step 4: Add shared layout**

Create `apps/web/src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: '灵犀门户',
  description: '个人门户、导航、工具箱和服务器入口',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <header>
          <nav>
            <Link href="/">灵犀门户</Link>
            <Link href="/nav">导航</Link>
            <Link href="/tools">工具</Link>
            <Link href="/login">登录</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
```

Create `apps/web/src/app/globals.css`:

```css
:root {
  color-scheme: light;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #f7f8fa;
  color: #171717;
}

header {
  border-bottom: 1px solid #e5e7eb;
  background: #ffffff;
}

nav {
  display: flex;
  gap: 16px;
  max-width: 1120px;
  margin: 0 auto;
  padding: 16px 24px;
}

a {
  color: inherit;
  text-decoration: none;
}

main {
  max-width: 1120px;
  margin: 0 auto;
  padding: 32px 24px;
}
```

- [ ] **Step 5: Add route pages**

Create `apps/web/src/app/page.tsx`:

```tsx
import { getApiHealth } from '@/lib/api';

export default async function HomePage() {
  const health = await getApiHealth().catch(() => null);

  return (
    <section>
      <h1>灵犀门户</h1>
      <p>公开主页、个人工作台、导航、工具箱和服务器入口。</p>
      <p>API 状态：{health ? `${health.service} ${health.status}` : '未连接'}</p>
    </section>
  );
}
```

Create `apps/web/src/app/nav/page.tsx`:

```tsx
export default function NavPage() {
  return (
    <section>
      <h1>公开导航</h1>
      <p>这里将展示所有公开可见的导航入口。</p>
    </section>
  );
}
```

Create `apps/web/src/app/login/page.tsx`:

```tsx
export default function LoginPage() {
  return (
    <section>
      <h1>登录</h1>
      <p>账号密码登录将在认证阶段实现。</p>
    </section>
  );
}
```

Create `apps/web/src/app/register/page.tsx`:

```tsx
export default function RegisterPage() {
  return (
    <section>
      <h1>注册</h1>
      <p>开放注册将在认证阶段实现，新用户默认角色为练气。</p>
    </section>
  );
}
```

Create `apps/web/src/app/dashboard/page.tsx`:

```tsx
export default function DashboardPage() {
  return (
    <section>
      <h1>个人工作台</h1>
      <p>登录后将展示按角色过滤后的导航、页面和工具。</p>
    </section>
  );
}
```

Create `apps/web/src/app/admin/page.tsx`:

```tsx
export default function AdminPage() {
  return (
    <section>
      <h1>管理后台</h1>
      <p>用户、角色、分类、链接、页面、工具和服务器入口管理将在后续阶段实现。</p>
    </section>
  );
}
```

- [ ] **Step 6: Add frontend Dockerfile**

Create `apps/web/Dockerfile`:

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --filter @lingxi/web... --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
RUN pnpm --filter @lingxi/web build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
```

- [ ] **Step 7: Install dependencies**

Run:

```bash
pnpm install
```

Expected: lockfile updates with frontend dependencies.

- [ ] **Step 8: Run frontend build**

Run:

```bash
pnpm --filter @lingxi/web build
```

Expected: Next.js build exits 0.

- [ ] **Step 9: Commit**

```bash
git add apps/web package.json pnpm-lock.yaml
git commit -m "feat(web): add portal shell"
```

---

### Task 6: Compose App Integration

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`

**Interfaces:**
- Produces `api` service available to containers at `http://api:3001`.
- Produces `web` service available on host port `${WEB_PORT:-3000}`.
- MySQL and Redis remain internal dependencies.

- [ ] **Step 1: Extend `.env.example`**

Ensure `.env.example` contains:

```dotenv
WEB_ORIGIN=http://localhost:3000
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

- [ ] **Step 2: Add backend and frontend services to Compose**

Modify `docker-compose.yml` to include these services in addition to `mysql` and `redis`:

```yaml
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    container_name: lingxi-api
    restart: unless-stopped
    environment:
      API_PORT: ${API_PORT:-3001}
      WEB_ORIGIN: ${WEB_ORIGIN:-http://localhost:3000}
      DATABASE_URL: mysql://${MYSQL_USER}:${MYSQL_PASSWORD}@mysql:3306/${MYSQL_DATABASE}
      REDIS_URL: redis://redis:6379
      JWT_ACCESS_SECRET: ${JWT_ACCESS_SECRET}
      JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET}
    ports:
      - "${API_PORT:-3001}:3001"
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_healthy

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    container_name: lingxi-web
    restart: unless-stopped
    environment:
      NEXT_PUBLIC_API_BASE_URL: ${NEXT_PUBLIC_API_BASE_URL:-http://localhost:3001}
    ports:
      - "${WEB_PORT:-3000}:3000"
    depends_on:
      - api
```

- [ ] **Step 3: Validate Compose config**

Run:

```bash
docker compose config
```

Expected: command exits 0.

- [ ] **Step 4: Build app containers**

Run:

```bash
docker compose build api web
```

Expected: both images build successfully.

- [ ] **Step 5: Start full stack**

Run:

```bash
docker compose up -d
```

Expected: `lingxi-mysql`, `lingxi-redis`, `lingxi-api`, and `lingxi-web` are running.

- [ ] **Step 6: Verify API health from host**

Run:

```bash
curl http://localhost:3001/health
```

Expected:

```json
{"status":"ok","service":"lingxi-api"}
```

- [ ] **Step 7: Verify frontend from host**

Run:

```bash
curl http://localhost:3000
```

Expected: HTML includes `灵犀门户`.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "chore: wire app services into compose"
```

---

### Task 7: Final Foundation Verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Produces verified local foundation ready for auth implementation.
- Produces README commands that match the actual project.

- [ ] **Step 1: Run backend tests**

Run:

```bash
pnpm --filter @lingxi/api test
```

Expected: all backend e2e tests pass.

- [ ] **Step 2: Run frontend build**

Run:

```bash
pnpm --filter @lingxi/web build
```

Expected: build exits 0.

- [ ] **Step 3: Run full build**

Run:

```bash
pnpm build
```

Expected: backend and frontend builds both exit 0.

- [ ] **Step 4: Update README if commands changed**

If any command in README differs from the commands that passed above, update `README.md` so the local development section exactly matches the verified workflow:

```markdown
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
```

- [ ] **Step 5: Check git status**

Run:

```bash
git status --short
```

Expected: only intentional README or generated migration changes are present.

- [ ] **Step 6: Commit README or verification adjustments**

If files changed:

```bash
git add README.md apps/api/prisma/migrations
git commit -m "docs: verify foundation workflow"
```

If no files changed, skip commit.

---

## Self-Review Notes

Spec coverage in this phase:

- Covered: separated frontend/backend structure, MySQL, Redis, Prisma, seeded cultivation roles, basic public routes, Docker Compose foundation.
- Deferred intentionally: registration, login, refresh token logic, role-based filtering, admin CRUD, server entry management, Markdown editor, production HTTPS deployment.

Placeholder scan:

- This plan avoids unresolved placeholder markers.
- Later-phase work is explicitly excluded from Phase 1 instead of being left vague inside tasks.

Type consistency:

- Role code used for default user role in later work is `qi_refining`.
- API health shape is `{ status: string; service: string }`.
- `/roles` returns objects with `code`, `name`, and `level`.
