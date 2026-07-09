# 灵犀门户项目基础实施计划

> **给智能执行员工：** 必须使用子技能：建议使用 `superpowers:subagent-driven-development`，或使用 `superpowers:executing-plans`，按任务逐项实施本计划。步骤使用复选框（`- [ ]`）语法便于跟踪。

**目标：** 建立灵犀门户的初始项目基础：monorepo、前端脚手架、后端脚手架、MySQL、Redis、Prisma 角色种子数据，以及基于 Docker 的本地开发环境。

**架构：** 本阶段创建一个前后端分离的 TypeScript monorepo。后端通过 Prisma 负责数据库访问，并提供健康检查和角色接口；前端是 Next.js 应用，通过 HTTP 调用后端。MySQL 存储持久业务数据，Redis 在后续阶段用于短期认证和安全状态。

**技术栈：** Next.js、NestJS、TypeScript、Prisma、MySQL 8.4 LTS、Redis、Docker Compose、pnpm。

## 全局约束

- 前端和后端分别放在 `apps/web` 和 `apps/api` 下，保持分离。
- 使用 MySQL 存储持久数据，使用 Redis 存储短期会话和安全状态。
- 初始化可分配角色：`练气`、`筑基`、`金丹`、`元婴`、`化神`、`炼虚`、`合体`、`大乘`、`管理员`。
- 后续认证功能中新用户默认角色为 `练气`；本阶段只负责初始化角色。
- 不要把密码、私钥、代理密码或服务器密钥写入项目仓库。
- `.env` 不进入 git，只提交 `.env.example`。
- `443` 保留给未来网站 HTTPS 使用，代理节点继续使用 `8443`。
- 本计划只覆盖第 1 阶段。认证、完整 CRUD、管理 UI、部署到 VPS 等功能放到后续阶段。

---

## 范围检查

完整产品规格覆盖多个子系统：认证、角色权限、导航管理、Markdown 页面、工具、服务器入口、部署和安全控制。本计划刻意只实现后续计划所需的基础能力。成功完成后，我们将得到一个可运行的本地栈、已初始化的角色、后端健康检查接口，以及前端基础外壳。

## 目标文件结构

创建如下结构：

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

职责划分：

- 根目录文件定义工作区、共享命令、环境变量示例、Docker Compose 和跨平台文本处理。
- `apps/api` 是 NestJS 后端，也是唯一直接访问 MySQL/Redis 的应用。
- `apps/web` 是 Next.js 前端，通过 HTTP 调用后端。
- `apps/api/prisma` 负责 schema、迁移和种子数据。

---

### 任务 1：工作区基础

**文件：**
- 创建：`package.json`
- 创建：`pnpm-workspace.yaml`
- 创建：`.editorconfig`
- 创建：`.gitattributes`
- 修改：`.gitignore`
- 修改：`README.md`

**接口：**
- 产出后续任务使用的根命令：`pnpm lint`、`pnpm test`、`pnpm dev`、`pnpm build`。
- 产出后续任务预期的工作区包名：`@lingxi/api` 和 `@lingxi/web`。

- [ ] **步骤 1：添加工作区 package manifest**

创建 `package.json`：

```json
{
  "name": "lingxi-portal",
  "private": true,
  "version": "0.1.0",
  "description": "Lingxi Portal personal portal platform",
  "packageManager": "pnpm@11.10.0",
  "scripts": {
    "dev": "pnpm --parallel --filter @lingxi/api --filter @lingxi/web dev",
    "build": "pnpm --filter @lingxi/api build && pnpm --filter @lingxi/web build",
    "lint": "pnpm --filter @lingxi/api lint && pnpm --filter @lingxi/web lint",
    "test": "pnpm --filter @lingxi/api test",
    "format": "pnpm --filter @lingxi/api format && pnpm --filter @lingxi/web format"
  }
}
```

- [ ] **步骤 2：添加 pnpm 工作区配置**

创建 `pnpm-workspace.yaml`：

```yaml
packages:
  - "apps/*"
```

- [ ] **步骤 3：添加编辑器配置**

创建 `.editorconfig`：

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

- [ ] **步骤 4：添加 git attributes**

创建 `.gitattributes`：

```gitattributes
* text=auto eol=lf
*.bat text eol=crlf
*.cmd text eol=crlf
*.ps1 text eol=crlf
```

- [ ] **步骤 5：扩展 gitignore**

修改 `.gitignore`，确保包含：

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

- [ ] **步骤 6：更新 README 的启动命令**

用以下内容替换 `README.md`：

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

- [ ] **步骤 7：验证工作区文件**

运行：

```bash
git status --short
```

预期：可以看到新增或修改的根目录文件。

- [ ] **步骤 8：提交**

```bash
git add package.json pnpm-workspace.yaml .editorconfig .gitattributes .gitignore README.md
git commit -m "chore: set up workspace baseline"
```

---

### 任务 2：Docker 基础设施和环境模板

**文件：**
- 创建：`.env.example`
- 创建：`docker-compose.yml`

**接口：**
- 产出 Prisma 使用的 MySQL 连接 URL：`DATABASE_URL`。
- 产出后端使用的 Redis 连接 URL：`REDIS_URL`。
- 产出前端使用的后端基础地址：`NEXT_PUBLIC_API_BASE_URL`。

- [ ] **步骤 1：添加环境变量示例**

创建 `.env.example`：

```dotenv
COMPOSE_PROJECT_NAME=lingxi_portal

MYSQL_ROOT_PASSWORD=change-me-root-password
MYSQL_HOST=localhost
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

- [ ] **步骤 2：添加 Docker Compose**

创建 `docker-compose.yml`：

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

- [ ] **步骤 3：创建本地环境文件**

运行：

```bash
cp .env.example .env
```

预期：`.env` 存在，并因为 `.gitignore` 保持未跟踪。

- [ ] **步骤 4：验证 Compose 语法**

运行：

```bash
docker compose config
```

预期：命令退出码为 0，并打印规范化后的 compose 配置。

- [ ] **步骤 5：启动 MySQL 和 Redis**

运行：

```bash
docker compose up -d mysql redis
```

预期：`lingxi-mysql` 和 `lingxi-redis` 容器启动。

- [ ] **步骤 6：验证服务健康状态**

运行：

```bash
docker compose ps
```

预期：两个服务都处于 running 状态，启动后健康检查变为 `healthy`。

- [ ] **步骤 7：提交**

```bash
git add .env.example docker-compose.yml
git commit -m "chore: add database and redis infrastructure"
```

---

### 任务 3：后端脚手架和健康检查接口

**文件：**
- 创建：`apps/api/package.json`
- 创建：`apps/api/tsconfig.json`
- 创建：`apps/api/tsconfig.build.json`
- 创建：`apps/api/nest-cli.json`
- 创建：`apps/api/eslint.config.mjs`
- 创建：`apps/api/Dockerfile`
- 创建：`apps/api/src/main.ts`
- 创建：`apps/api/src/app.module.ts`
- 创建：`apps/api/src/health/health.module.ts`
- 创建：`apps/api/src/health/health.controller.ts`
- 创建：`apps/api/test/jest-e2e.json`
- 创建：`apps/api/test/health.e2e-spec.ts`
- 修改：`pnpm-workspace.yaml`

**接口：**
- 产出监听 `process.env.API_PORT || 3001` 的 API 应用。
- 产出 `GET /health` 接口，返回 `{ "status": "ok", "service": "lingxi-api" }`。
- 后续后端模块会导入到 `AppModule`。

- [ ] **步骤 1：创建后端 package manifest**

创建 `apps/api/package.json`：

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
    "test": "jest --config test/jest-e2e.json --runInBand",
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
    "@eslint/js": "latest",
    "@nestjs/cli": "latest",
    "@nestjs/schematics": "latest",
    "@nestjs/testing": "latest",
    "@types/express": "latest",
    "@types/jest": "latest",
    "@types/node": "latest",
    "@types/supertest": "latest",
    "@typescript-eslint/eslint-plugin": "latest",
    "@typescript-eslint/parser": "latest",
    "eslint": "9.39.4",
    "jest": "latest",
    "prettier": "latest",
    "prisma": "latest",
    "source-map-support": "latest",
    "supertest": "latest",
    "ts-jest": "latest",
    "ts-loader": "latest",
    "ts-node": "latest",
    "tsx": "latest",
    "typescript": "latest",
    "typescript-eslint": "latest"
  }
}
```

- [ ] **步骤 2：添加 TypeScript 配置**

创建 `apps/api/tsconfig.json`：

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
    "incremental": true,
    "strict": true,
    "types": ["node", "jest"],
    "skipLibCheck": true
  }
}
```

创建 `apps/api/tsconfig.build.json`：

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src"
  },
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts"]
}
```

创建 `apps/api/nest-cli.json`：

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

创建 `apps/api/eslint.config.mjs`：

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
```

- [ ] **步骤 3：添加后端应用代码**

创建 `apps/api/src/main.ts`：

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

创建 `apps/api/src/app.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';

@Module({
  imports: [HealthModule],
})
export class AppModule {}
```

创建 `apps/api/src/health/health.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```

创建 `apps/api/src/health/health.controller.ts`：

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

- [ ] **步骤 4：添加后端 Dockerfile**

创建 `apps/api/Dockerfile`：

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma/schema.prisma apps/api/prisma/schema.prisma
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts
RUN pnpm install --filter @lingxi/api... --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .
RUN pnpm --filter @lingxi/api prisma:generate
RUN pnpm --filter @lingxi/api build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
```

- [ ] **步骤 5：添加健康检查 e2e 测试**

创建 `apps/api/test/jest-e2e.json`：

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

创建 `apps/api/test/health.e2e-spec.ts`：

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

- [ ] **步骤 6：安装依赖**

从仓库根目录运行：

```bash
pnpm install
pnpm approve-builds --all
```

预期：创建 `pnpm-lock.yaml`。

如果 pnpm 把已批准的构建依赖写入 `pnpm-workspace.yaml`，保留生成的白名单，确保后续安装可以非交互执行：

```yaml
allowBuilds:
  '@prisma/engines': true
  esbuild: true
  prisma: true
  sharp: true
  unrs-resolver: true
```

- [ ] **步骤 7：运行后端健康检查测试**

运行：

```bash
pnpm --filter @lingxi/api test -- health.e2e-spec.ts
```

预期：`GET /health returns service status` 测试通过。

- [ ] **步骤 8：提交**

```bash
git add apps/api package.json pnpm-lock.yaml
git commit -m "feat(api): add nest health scaffold"
```

---

### 任务 4：Prisma Schema 和角色种子数据

**文件：**
- 修改：`.env.example`
- 修改：`.gitignore`
- 修改：`apps/api/package.json`
- 创建：`apps/api/prisma.config.ts`
- 创建：`apps/api/prisma/schema.prisma`
- 创建：`apps/api/prisma/migrations/20260709031500_init_roles/migration.sql`
- 创建：`apps/api/prisma/migrations/migration_lock.toml`
- 创建：`apps/api/prisma/seed.ts`
- 创建：`apps/api/src/prisma/prisma-client.factory.ts`
- 创建：`apps/api/src/prisma/prisma.service.ts`
- 创建：`apps/api/src/roles/roles.module.ts`
- 创建：`apps/api/src/roles/roles.service.ts`
- 创建：`apps/api/src/roles/roles.controller.ts`
- 修改：`apps/api/src/app.module.ts`
- 修改：`apps/api/test/health.e2e-spec.ts`
- 创建：`apps/api/test/roles.e2e-spec.ts`

**接口：**
- 产出 Prisma 模型 `Role`，字段为 `id`、`code`、`name`、`level`、`sortOrder`、`createdAt`、`updatedAt`。
- 产出 `GET /roles` 接口，按 level 升序返回角色。
- 后续认证功能使用 `Role.code === "qi_refining"` 作为新用户默认角色。

- [ ] **步骤 1：添加 Prisma schema**

确保 `.env.example` 包含 `MYSQL_HOST=localhost`。

确保 `.gitignore` 忽略生成的 Prisma Client 和意外编译出的 Prisma 配置文件：

```gitignore
apps/api/src/generated/prisma/
apps/api/prisma.config.d.ts
apps/api/prisma.config.js
apps/api/prisma.config.js.map
```

确保 `apps/api/package.json` 包含这些运行时依赖：

```json
{
  "dependencies": {
    "@prisma/adapter-mariadb": "latest",
    "dotenv": "latest"
  }
}
```

创建 `apps/api/prisma.config.ts`：

```ts
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({ path: '../../.env', quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
```

创建 `apps/api/prisma/schema.prisma`：

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "mysql"
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

- [ ] **步骤 2：添加角色种子脚本**

创建 `apps/api/prisma/seed.ts`：

```ts
import { createPrismaClient } from '../src/prisma/prisma-client.factory';

const prisma = createPrismaClient();

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

- [ ] **步骤 3：生成 Prisma Client**

运行：

```bash
pnpm --filter @lingxi/api prisma:generate
```

预期：Prisma Client 生成成功。

- [ ] **步骤 4：执行迁移**

运行：

```bash
pnpm --filter @lingxi/api prisma:migrate -- --name init_roles
```

预期：迁移在 MySQL 中创建 `roles` 表。

- [ ] **步骤 5：写入角色种子数据**

运行：

```bash
pnpm --filter @lingxi/api prisma:seed
```

预期：命令退出码为 0，没有错误。

- [ ] **步骤 6：添加角色模块**

创建 `apps/api/src/prisma/prisma-client.factory.ts`：

```ts
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { config } from 'dotenv';
import { PrismaClient } from '../generated/prisma/client';

config({ path: '../../.env', quiet: true });

function getDatabaseConfig() {
  const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;

  if (!databaseUrl && !process.env.MYSQL_PASSWORD) {
    throw new Error('DATABASE_URL or MYSQL_PASSWORD must be configured before using Prisma.');
  }

  return {
    host: process.env.MYSQL_HOST ?? databaseUrl?.hostname ?? 'localhost',
    port: Number(process.env.MYSQL_PORT ?? databaseUrl?.port ?? 3306),
    user: process.env.MYSQL_USER ?? decodeURIComponent(databaseUrl?.username ?? 'lingxi'),
    password: process.env.MYSQL_PASSWORD ?? decodeURIComponent(databaseUrl?.password ?? ''),
    database:
      process.env.MYSQL_DATABASE ??
      decodeURIComponent(databaseUrl?.pathname.replace(/^\//, '') ?? 'lingxi_portal'),
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT ?? 5),
  };
}

export function createPrismaAdapter() {
  return new PrismaMariaDb(getDatabaseConfig());
}

export function createPrismaClient() {
  return new PrismaClient({ adapter: createPrismaAdapter() });
}
```

创建 `apps/api/src/prisma/prisma.service.ts`：

```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';
import { createPrismaAdapter } from './prisma-client.factory';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ adapter: createPrismaAdapter() });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

创建 `apps/api/src/roles/roles.service.ts`：

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

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

创建 `apps/api/src/roles/roles.controller.ts`：

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

创建 `apps/api/src/roles/roles.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  controllers: [RolesController],
  providers: [PrismaService, RolesService],
})
export class RolesModule {}
```

修改 `apps/api/src/app.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { RolesModule } from './roles/roles.module';

@Module({
  imports: [HealthModule, RolesModule],
})
export class AppModule {}
```

修改 `apps/api/test/health.e2e-spec.ts`，让健康检查测试在编译测试模块前用 no-op 的 `$connect` 和 `$disconnect` 覆盖 `PrismaService`。这样在 `AppModule` 引入 `RolesModule` 后，健康检查测试仍然不依赖运行中的数据库。

- [ ] **步骤 7：添加角色 e2e 测试**

创建 `apps/api/test/roles.e2e-spec.ts`：

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const cultivationRoles = [
  { code: 'qi_refining', name: '练气', level: 10 },
  { code: 'foundation_building', name: '筑基', level: 20 },
  { code: 'golden_core', name: '金丹', level: 30 },
  { code: 'nascent_soul', name: '元婴', level: 40 },
  { code: 'spirit_transformation', name: '化神', level: 50 },
  { code: 'void_refining', name: '炼虚', level: 60 },
  { code: 'body_integration', name: '合体', level: 70 },
  { code: 'mahayana', name: '大乘', level: 80 },
  { code: 'administrator', name: '管理员', level: 90 },
];

describe('RolesController (e2e)', () => {
  let app: INestApplication;
  const findMany = jest.fn().mockResolvedValue(cultivationRoles);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        role: {
          findMany,
        },
        $connect: jest.fn(),
        $disconnect: jest.fn(),
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /roles returns seeded cultivation roles', async () => {
    const response = await request(app.getHttpServer()).get('/roles').expect(200);

    expect(response.body).toEqual(cultivationRoles);
    expect(findMany).toHaveBeenCalledWith({
      orderBy: { level: 'asc' },
      select: {
        code: true,
        name: true,
        level: true,
      },
    });
  });
});
```

- [ ] **步骤 8：运行角色测试**

运行：

```bash
pnpm --filter @lingxi/api test -- roles.e2e-spec.ts
```

预期：`GET /roles returns seeded cultivation roles` 测试通过。

- [ ] **步骤 9：提交**

```bash
git add .env.example .gitignore apps/api/package.json apps/api/prisma.config.ts apps/api/prisma apps/api/src apps/api/test pnpm-lock.yaml
git commit -m "feat(api): seed cultivation roles"
```

---

### 任务 5：前端脚手架和公开外壳

**文件：**
- 创建：`apps/web/package.json`
- 创建：`apps/web/next.config.ts`
- 创建：`apps/web/tsconfig.json`
- 创建：`apps/web/eslint.config.mjs`
- 创建：`apps/web/Dockerfile`
- 修改：`.gitignore`
- 创建：`apps/web/public/.gitkeep`
- 创建：`apps/web/src/app/layout.tsx`
- 创建：`apps/web/src/app/globals.css`
- 创建：`apps/web/src/app/page.tsx`
- 创建：`apps/web/src/app/nav/page.tsx`
- 创建：`apps/web/src/app/tools/page.tsx`
- 创建：`apps/web/src/app/login/page.tsx`
- 创建：`apps/web/src/app/register/page.tsx`
- 创建：`apps/web/src/app/dashboard/page.tsx`
- 创建：`apps/web/src/app/admin/page.tsx`
- 创建：`apps/web/src/lib/api.ts`

**接口：**
- 产出运行在 `3000` 端口的前端应用 `@lingxi/web`。
- 产出与设计文档匹配的公开外壳路由。
- 使用 `NEXT_PUBLIC_API_BASE_URL` 作为后端基础地址。

- [ ] **步骤 1：创建前端 package manifest**

创建 `apps/web/package.json`：

```json
{
  "name": "@lingxi/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start --port 3000",
    "lint": "eslint \"src/**/*.{ts,tsx}\"",
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
    "eslint": "9.39.4",
    "eslint-config-next": "latest",
    "prettier": "latest",
    "typescript": "latest"
  }
}
```

确保 `.gitignore` 包含 `apps/web/next-env.d.ts`。该文件由 Next.js 生成和维护，不应该手写或提交。

- [ ] **步骤 2：添加 Next.js 配置**

创建 `apps/web/next.config.ts`：

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
};

export default nextConfig;
```

创建 `apps/web/tsconfig.json`：

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
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

创建 `apps/web/eslint.config.mjs`：

```js
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default [...nextVitals, ...nextTypescript];
```

- [ ] **步骤 3：添加前端 API helper**

创建 `apps/web/src/lib/api.ts`：

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

- [ ] **步骤 4：添加共享布局**

创建 `apps/web/src/app/layout.tsx`：

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
          <nav aria-label="主导航">
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

创建 `apps/web/src/app/globals.css`：

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

- [ ] **步骤 5：添加路由页面**

创建 `apps/web/src/app/page.tsx`：

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

创建 `apps/web/src/app/nav/page.tsx`：

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

创建 `apps/web/src/app/tools/page.tsx`：

```tsx
export default function ToolsPage() {
  return (
    <section>
      <h1>工具箱</h1>
      <p>登录后可按角色查看可用工具。</p>
    </section>
  );
}
```

创建 `apps/web/src/app/login/page.tsx`：

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

创建 `apps/web/src/app/register/page.tsx`：

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

创建 `apps/web/src/app/dashboard/page.tsx`：

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

创建 `apps/web/src/app/admin/page.tsx`：

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

- [ ] **步骤 6：添加前端 Dockerfile**

创建 `apps/web/Dockerfile`：

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
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

- [ ] **步骤 7：安装依赖**

运行：

```bash
pnpm install
pnpm approve-builds --all
```

预期：lockfile 更新并包含前端依赖。

- [ ] **步骤 8：运行前端构建**

运行：

```bash
pnpm --filter @lingxi/web build
```

预期：Next.js 构建退出码为 0。

- [ ] **步骤 9：提交**

```bash
git add apps/web package.json pnpm-lock.yaml
git commit -m "feat(web): add portal shell"
```

---

### 任务 6：Compose 应用集成

**文件：**
- 修改：`docker-compose.yml`
- 修改：`.env.example`

**接口：**
- 产出容器内可访问的 `api` 服务：`http://api:3001`。
- 产出通过主机端口 `${WEB_PORT:-3000}` 访问的 `web` 服务。
- MySQL 和 Redis 仍作为内部依赖。

- [ ] **步骤 1：扩展 `.env.example`**

确保 `.env.example` 包含：

```dotenv
WEB_ORIGIN=http://localhost:3000
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

- [ ] **步骤 2：在 Compose 中添加后端和前端服务**

修改 `docker-compose.yml`，在 `mysql` 和 `redis` 之外加入以下服务：

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
      MYSQL_HOST: mysql
      MYSQL_PORT: 3306
      MYSQL_DATABASE: ${MYSQL_DATABASE}
      MYSQL_USER: ${MYSQL_USER}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
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
      NEXT_PUBLIC_API_BASE_URL: http://api:3001
    ports:
      - "${WEB_PORT:-3000}:3000"
    depends_on:
      - api
```

- [ ] **步骤 3：验证 Compose 配置**

运行：

```bash
docker compose config
```

预期：命令退出码为 0。

- [ ] **步骤 4：构建应用容器**

运行：

```bash
docker compose build api web
```

预期：两个镜像都构建成功。

- [ ] **步骤 5：启动完整栈**

运行：

```bash
docker compose up -d
```

预期：`lingxi-mysql`、`lingxi-redis`、`lingxi-api` 和 `lingxi-web` 都在运行。

- [ ] **步骤 6：从主机验证 API 健康检查**

运行：

```bash
curl http://localhost:3001/health
```

预期：

```json
{"status":"ok","service":"lingxi-api"}
```

- [ ] **步骤 7：从主机验证前端**

运行：

```bash
curl http://localhost:3000
```

预期：HTML 中包含 `灵犀门户`。

- [ ] **步骤 8：提交**

```bash
git add docker-compose.yml .env.example
git commit -m "chore: wire app services into compose"
```

---

### 任务 7：最终基础验证

**文件：**
- 修改：`README.md`

**接口：**
- 产出已验证的本地基础项目，可进入认证功能实施。
- 产出与实际项目一致的 README 命令。

- [ ] **步骤 1：运行后端测试**

运行：

```bash
pnpm --filter @lingxi/api test
```

预期：所有后端 e2e 测试通过。

- [ ] **步骤 2：运行前端构建**

运行：

```bash
pnpm --filter @lingxi/web build
```

预期：构建退出码为 0。

- [ ] **步骤 3：运行完整构建**

运行：

```bash
pnpm build
```

预期：后端和前端构建都退出码为 0。

- [ ] **步骤 4：如果命令有变化，更新 README**

如果 README 中任何命令和上面已通过验证的命令不一致，更新 `README.md`，确保本地开发部分与实际已验证流程完全一致：

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

- [ ] **步骤 5：检查 git 状态**

运行：

```bash
git status --short
```

预期：只存在有意修改的 README 或生成的迁移文件。

- [ ] **步骤 6：提交 README 或验证调整**

如果有文件变化：

```bash
git add README.md apps/api/prisma/migrations
git commit -m "docs: verify foundation workflow"
```

如果没有文件变化，则跳过提交。

---

## 自检说明

本阶段规格覆盖：

- 已覆盖：前后端分离结构、MySQL、Redis、Prisma、修仙角色种子数据、基础公开路由、Docker Compose 基础。
- 有意延后：注册、登录、Refresh Token 逻辑、基于角色的过滤、管理端 CRUD、服务器入口管理、Markdown 编辑器、生产 HTTPS 部署。

占位符扫描：

- 本计划避免未解决的占位标记。
- 后续阶段工作被明确排除在第 1 阶段之外，而不是模糊地留在任务中。

类型一致性：

- 后续新用户默认角色使用的角色 code 为 `qi_refining`。
- API 健康检查返回结构为 `{ status: string; service: string }`。
- `/roles` 返回包含 `code`、`name` 和 `level` 的对象。
