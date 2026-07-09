# 认证与角色权限基础实施计划

> **给智能执行员工：** 必须使用子技能：建议使用 `superpowers:subagent-driven-development`，或使用 `superpowers:executing-plans`，按任务逐项实施本计划。步骤使用复选框（`- [ ]`）语法便于跟踪。

**目标：** 为灵犀门户加入真实注册、登录、Refresh Token 会话、退出登录、当前用户查询，以及可复用的角色权限工具。

**架构：** 后端新增 `UsersModule`、`AuthModule` 和 `RedisModule`，继续把 Prisma 作为数据库边界。Access Token 使用 JWT；Refresh Token 使用随机不透明字符串，并以哈希形式保存在 Redis。前端把占位登录/注册页替换成客户端表单，通过类型清晰的 API helper 调用后端，并在 `/dashboard` 展示登录身份。

**技术栈：** NestJS、Next.js、TypeScript、Prisma、MySQL 8.4、Redis、`@nestjs/jwt`、`bcryptjs`、`ioredis`、pnpm。

## 全局约束

- 前端和后端分别保持在 `apps/web` 与 `apps/api` 下。
- 持久用户和角色数据通过 Prisma 存入 MySQL。
- Refresh Token 状态和登录失败计数只存 Redis。
- 不要把明文密码或明文 Refresh Token 写入 MySQL、Redis、文档、源码或对话。
- 新注册用户默认角色 code 为 `qi_refining`。
- `isSuperAdmin = true` 跳过角色等级检查。
- 角色等级 90 可以查看服务器入口；只有超级管理员可以管理服务器入口。
- 本阶段不实现导航、页面、工具、服务器入口 CRUD、角色分配 UI、邮箱验证或两步验证。
- 新增项目文档保持中英文双份。

---

## 范围检查

本计划只实现 `docs/superpowers/specs/2026-07-09-auth-rbac-design.zh-CN.md` 中的认证和角色权限基础。内容 CRUD 和管理界面有意排除在外，先把身份层验证清楚，再让后续模块依赖它。

## 目标文件结构

```text
apps/api/
  prisma/
    schema.prisma
    migrations/
      20260709090000_add_auth_users/
        migration.sql
  src/
    app.module.ts
    main.ts
    auth/
      auth.controller.ts
      auth.module.ts
      auth.service.ts
      auth.types.ts
      current-user.decorator.ts
      dto/
        login.dto.ts
        refresh-token.dto.ts
        register.dto.ts
      guards/
        jwt-auth.guard.ts
      password.service.ts
      permissions.ts
      refresh-token.service.ts
    redis/
      redis.module.ts
      redis.service.ts
    users/
      users.module.ts
      users.service.ts
  test/
    auth.e2e-spec.ts
    permissions.e2e-spec.ts
apps/web/
  src/
    app/
      dashboard/page.tsx
      login/page.tsx
      register/page.tsx
    lib/
      auth-api.ts
      auth-storage.ts
.env.example
docs/superpowers/plans/
  2026-07-09-auth-rbac-foundation.md
  2026-07-09-auth-rbac-foundation.zh-CN.md
```

职责划分：

- `UsersService` 负责用户查询、创建，以及带状态判断的当前用户加载。
- `AuthService` 编排注册、登录、刷新、退出和 `/me`。
- `PasswordService` 负责密码哈希和校验。
- `RefreshTokenService` 负责 Refresh Token 生成、哈希、Redis 保存、轮换和退出删除。
- `RedisService` 封装 `ioredis`，只暴露认证需要的小范围命令。
- `permissions.ts` 提供纯函数权限判断，供后续模块复用，也方便快速单测。
- `auth-api.ts` 和 `auth-storage.ts` 把浏览器 API 调用、token 保存逻辑与 React 页面隔离开。

---

### 任务 1：用户 Schema 和认证依赖

**文件：**
- 修改：`apps/api/package.json`
- 修改：`apps/api/prisma/schema.prisma`
- 创建：`apps/api/prisma/migrations/20260709090000_add_auth_users/migration.sql`
- 修改：`.env.example`
- 修改：`docker-compose.yml`

**接口：**
- 产出 Prisma `User` 模型和 `UserStatus` 枚举。
- 增加后续任务需要的运行时依赖：`@nestjs/jwt`、`bcryptjs`、`ioredis`。
- 增加认证服务使用的环境变量：`JWT_ACCESS_SECRET`、`JWT_ACCESS_EXPIRES_IN`、`REFRESH_TOKEN_SECRET`、`REFRESH_TOKEN_EXPIRES_IN_DAYS`。

- [ ] **步骤 1：写清 schema 目标**

编辑生产代码前，先用本地临时记录确认迁移目标：

```text
User 字段：id, username, email, passwordHash, roleId, isSuperAdmin, status, lastLoginAt, createdAt, updatedAt。
Role 关联：Role.users。
UserStatus 枚举：active, disabled。
```

- [ ] **步骤 2：更新依赖**

在 `apps/api/package.json` dependencies 中加入：

```json
{
  "@nestjs/jwt": "latest",
  "bcryptjs": "latest",
  "ioredis": "latest"
}
```

不需要额外添加 `bcryptjs` 类型包，因为 `bcryptjs` 已自带类型。

- [ ] **步骤 3：扩展 Prisma schema**

修改 `apps/api/prisma/schema.prisma`：

```prisma
enum UserStatus {
  active
  disabled
}

model Role {
  id        Int      @id @default(autoincrement())
  code      String   @unique @db.VarChar(64)
  name      String   @db.VarChar(64)
  level     Int      @unique
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  users     User[]

  @@map("roles")
}

model User {
  id           Int        @id @default(autoincrement())
  username     String     @unique @db.VarChar(32)
  email        String     @unique @db.VarChar(191)
  passwordHash String     @map("password_hash") @db.VarChar(255)
  roleId       Int        @map("role_id")
  role         Role       @relation(fields: [roleId], references: [id])
  isSuperAdmin Boolean    @default(false) @map("is_super_admin")
  status       UserStatus @default(active)
  lastLoginAt  DateTime?  @map("last_login_at")
  createdAt    DateTime   @default(now()) @map("created_at")
  updatedAt    DateTime   @updatedAt @map("updated_at")

  @@index([roleId])
  @@map("users")
}
```

- [ ] **步骤 4：添加 SQL 迁移**

创建 `apps/api/prisma/migrations/20260709090000_add_auth_users/migration.sql`：

```sql
CREATE TABLE `users` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(32) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role_id` INTEGER NOT NULL,
  `is_super_admin` BOOLEAN NOT NULL DEFAULT false,
  `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  `last_login_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `users_username_key`(`username`),
  UNIQUE INDEX `users_email_key`(`email`),
  INDEX `users_role_id_idx`(`role_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `users`
  ADD CONSTRAINT `users_role_id_fkey`
  FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **步骤 5：扩展环境变量模板**

确保 `.env.example` 包含：

```dotenv
JWT_ACCESS_SECRET=change-me-access-secret
JWT_ACCESS_EXPIRES_IN=15m
REFRESH_TOKEN_SECRET=change-me-refresh-token-secret
REFRESH_TOKEN_EXPIRES_IN_DAYS=30
```

确保 `docker-compose.yml` 把这些变量传给 `api` 服务。

- [ ] **步骤 6：安装并生成 Prisma Client**

运行：

```bash
pnpm install
pnpm --filter @lingxi/api prisma:generate
```

预期：Prisma Client 生成命令退出码为 0。

- [ ] **步骤 7：提交**

```bash
git add apps/api/package.json apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260709090000_add_auth_users/migration.sql .env.example docker-compose.yml pnpm-lock.yaml
git commit -m "feat(api): add user auth schema"
```

---

### 任务 2：权限工具

**文件：**
- 创建：`apps/api/src/auth/auth.types.ts`
- 创建：`apps/api/src/auth/permissions.ts`
- 创建：`apps/api/test/permissions.e2e-spec.ts`

**接口：**
- 产出 `AuthenticatedUser`。
- 产出 `isSuperAdmin`、`hasRoleLevel`、`canViewServerEntries` 和 `canManageServerEntries`。

- [ ] **步骤 1：先写失败的权限测试**

创建 `apps/api/test/permissions.e2e-spec.ts`：

```ts
import {
  canManageServerEntries,
  canViewServerEntries,
  hasRoleLevel,
  isSuperAdmin,
} from '../src/auth/permissions';
import { AuthenticatedUser } from '../src/auth/auth.types';

const user = (level: number, isSuper = false): AuthenticatedUser => ({
  id: 1,
  username: 'tester',
  email: 'tester@example.com',
  status: 'active',
  isSuperAdmin: isSuper,
  role: {
    code: isSuper ? 'administrator' : 'qi_refining',
    name: isSuper ? '管理员' : '练气',
    level,
  },
});

describe('permission helpers', () => {
  it('treats isSuperAdmin as super admin', () => {
    expect(isSuperAdmin(user(10, true))).toBe(true);
    expect(isSuperAdmin(user(90, false))).toBe(false);
  });

  it('allows super admin to bypass role level checks', () => {
    expect(hasRoleLevel(user(10, true), 90)).toBe(true);
  });

  it('checks regular users by role level', () => {
    expect(hasRoleLevel(user(30), 20)).toBe(true);
    expect(hasRoleLevel(user(10), 30)).toBe(false);
  });

  it('allows administrator level users to view server entries', () => {
    expect(canViewServerEntries(user(90))).toBe(true);
    expect(canViewServerEntries(user(80))).toBe(false);
  });

  it('allows only super admin to manage server entries', () => {
    expect(canManageServerEntries(user(90))).toBe(false);
    expect(canManageServerEntries(user(10, true))).toBe(true);
  });
});
```

- [ ] **步骤 2：验证 RED**

运行：

```bash
pnpm --filter @lingxi/api test -- permissions.e2e-spec.ts
```

预期：失败，原因是 `../src/auth/permissions` 不存在。

- [ ] **步骤 3：实现权限工具**

创建 `apps/api/src/auth/auth.types.ts`：

```ts
export type UserStatus = 'active' | 'disabled';

export interface AuthenticatedUser {
  id: number;
  username: string;
  email: string;
  status: UserStatus;
  isSuperAdmin: boolean;
  role: {
    code: string;
    name: string;
    level: number;
  };
}
```

创建 `apps/api/src/auth/permissions.ts`：

```ts
import { AuthenticatedUser } from './auth.types';

export function isSuperAdmin(user: AuthenticatedUser): boolean {
  return user.isSuperAdmin;
}

export function hasRoleLevel(user: AuthenticatedUser, minLevel: number): boolean {
  return isSuperAdmin(user) || user.role.level >= minLevel;
}

export function canViewServerEntries(user: AuthenticatedUser): boolean {
  return hasRoleLevel(user, 90);
}

export function canManageServerEntries(user: AuthenticatedUser): boolean {
  return isSuperAdmin(user);
}
```

- [ ] **步骤 4：验证 GREEN**

运行：

```bash
pnpm --filter @lingxi/api test -- permissions.e2e-spec.ts
```

预期：通过。

- [ ] **步骤 5：提交**

```bash
git add apps/api/src/auth/auth.types.ts apps/api/src/auth/permissions.ts apps/api/test/permissions.e2e-spec.ts
git commit -m "feat(api): add role permission helpers"
```

---

### 任务 3：用户、Redis、密码和 Refresh Token 服务

**文件：**
- 创建：`apps/api/src/users/users.module.ts`
- 创建：`apps/api/src/users/users.service.ts`
- 创建：`apps/api/src/redis/redis.module.ts`
- 创建：`apps/api/src/redis/redis.service.ts`
- 创建：`apps/api/src/auth/password.service.ts`
- 创建：`apps/api/src/auth/refresh-token.service.ts`
- 创建：`apps/api/test/auth-services.e2e-spec.ts`

**接口：**
- 产出 `UsersService.createUser`、`findForLogin`、`findActiveById` 和 `markLoginSuccess`。
- 产出 `PasswordService.hashPassword` 和 `verifyPassword`。
- 产出 `RefreshTokenService.issue`、`rotate` 和 `revoke`。

- [ ] **步骤 1：先写失败的服务测试**

创建 `apps/api/test/auth-services.e2e-spec.ts`，用 fake Prisma 和 fake Redis 实例化服务：

```ts
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PasswordService } from '../src/auth/password.service';
import { RefreshTokenService } from '../src/auth/refresh-token.service';
import { UsersService } from '../src/users/users.service';

describe('auth support services', () => {
  it('hashes passwords without returning plaintext', async () => {
    const service = new PasswordService();
    const hash = await service.hashPassword('Secret123!');

    expect(hash).not.toBe('Secret123!');
    await expect(service.verifyPassword('Secret123!', hash)).resolves.toBe(true);
    await expect(service.verifyPassword('bad', hash)).resolves.toBe(false);
  });

  it('rejects disabled users in active lookup', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 2,
          username: 'disabled',
          email: 'disabled@example.com',
          status: 'disabled',
          isSuperAdmin: false,
          role: { code: 'qi_refining', name: '练气', level: 10 },
        }),
      },
    };
    const service = new UsersService(prisma as never);

    await expect(service.findActiveById(2)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rotates refresh tokens by removing old state', async () => {
    const redisStore = new Map<string, string>();
    const redisSets = new Map<string, Set<string>>();
    const redis = {
      set: jest.fn(async (key: string, value: string) => redisStore.set(key, value)),
      get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
      del: jest.fn(async (key: string) => {
        redisStore.delete(key);
        return 1;
      }),
      sadd: jest.fn(async (key: string, value: string) => {
        const set = redisSets.get(key) ?? new Set<string>();
        set.add(value);
        redisSets.set(key, set);
      }),
      srem: jest.fn(async (key: string, value: string) => {
        redisSets.get(key)?.delete(value);
      }),
    };
    const users = {
      findActiveById: jest.fn().mockResolvedValue({
        id: 1,
        username: 'tester',
        email: 'tester@example.com',
        status: 'active',
        isSuperAdmin: false,
        role: { code: 'qi_refining', name: '练气', level: 10 },
      }),
    };
    const service = new RefreshTokenService(redis as never, users as never);

    const first = await service.issue(1);
    const second = await service.rotate(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expect(service.rotate(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **步骤 2：验证 RED**

运行：

```bash
pnpm --filter @lingxi/api test -- auth-services.e2e-spec.ts
```

预期：失败，原因是相关服务不存在。

- [ ] **步骤 3：实现服务文件**

实现服务文件，并提供这些公开方法：

```ts
// UsersService
createUser(input: { username: string; email: string; passwordHash: string }): Promise<AuthenticatedUser & { passwordHash: string }>;
findForLogin(account: string): Promise<(AuthenticatedUser & { passwordHash: string }) | null>;
findActiveById(id: number): Promise<AuthenticatedUser>;
markLoginSuccess(id: number): Promise<void>;
```

```ts
// PasswordService
hashPassword(password: string): Promise<string>;
verifyPassword(password: string, hash: string): Promise<boolean>;
```

```ts
// RefreshTokenService
issue(userId: number): Promise<{ refreshToken: string; tokenId: string; expiresAt: Date }>;
rotate(refreshToken: string): Promise<{ refreshToken: string; tokenId: string; expiresAt: Date; user: AuthenticatedUser }>;
revoke(refreshToken: string): Promise<void>;
```

实现规则：

- bcrypt cost 使用 `12`。
- `UsersService.createUser` 中把 email 统一转小写。
- 登录账号查询使用 `OR: [{ username: account }, { email: account.toLowerCase() }]`。
- Refresh Token 格式使用 `${tokenId}.${secret}`。
- 使用 `REFRESH_TOKEN_SECRET` 和 `HMAC-SHA256` 哈希 Refresh Token。
- Refresh Token 记录以 JSON 存到 `refresh_token:{tokenId}`。
- 活跃 token id 存在 `user_sessions:{userId}`。

- [ ] **步骤 4：验证 GREEN**

运行：

```bash
pnpm --filter @lingxi/api test -- auth-services.e2e-spec.ts
```

预期：通过。

- [ ] **步骤 5：提交**

```bash
git add apps/api/src/users apps/api/src/redis apps/api/src/auth/password.service.ts apps/api/src/auth/refresh-token.service.ts apps/api/test/auth-services.e2e-spec.ts
git commit -m "feat(api): add auth support services"
```

---

### 任务 4：认证 API 和 JWT Guard

**文件：**
- 创建：`apps/api/src/auth/dto/register.dto.ts`
- 创建：`apps/api/src/auth/dto/login.dto.ts`
- 创建：`apps/api/src/auth/dto/refresh-token.dto.ts`
- 创建：`apps/api/src/auth/current-user.decorator.ts`
- 创建：`apps/api/src/auth/guards/jwt-auth.guard.ts`
- 创建：`apps/api/src/auth/auth.service.ts`
- 创建：`apps/api/src/auth/auth.controller.ts`
- 创建：`apps/api/src/auth/auth.module.ts`
- 修改：`apps/api/src/app.module.ts`
- 修改：`apps/api/src/main.ts`
- 创建：`apps/api/test/auth.e2e-spec.ts`

**接口：**
- 产出 `POST /auth/register`、`POST /auth/login`、`POST /auth/refresh`、`POST /auth/logout` 和 `GET /auth/me`。
- 产出 `/auth/me` 使用的 Bearer Token guard。

- [ ] **步骤 1：先写失败的 API 测试**

创建 `apps/api/test/auth.e2e-spec.ts`，覆盖：

```ts
it('registers a user with the qi_refining role');
it('rejects duplicate username or email');
it('logs in with username and returns tokens');
it('logs in with email and returns tokens');
it('rejects wrong passwords and blocks after five failures');
it('refreshes by rotating refresh token state');
it('logs out by revoking refresh token state');
it('returns /auth/me for a valid access token');
it('rejects disabled users during login and refresh');
```

使用 `Test.createTestingModule({ imports: [AppModule] })`，用内存用户/角色行为覆盖 `PrismaService`，用内存 key/value 和 set 行为覆盖 `RedisService`。在 `app.init()` 前应用与 `main.ts` 相同的 `ValidationPipe`。

- [ ] **步骤 2：验证 RED**

运行：

```bash
pnpm --filter @lingxi/api test -- auth.e2e-spec.ts
```

预期：失败，原因是 `AuthModule` 和路由不存在。

- [ ] **步骤 3：实现 DTO 和校验**

如果缺少校验依赖，安装：

```json
{
  "class-transformer": "latest",
  "class-validator": "latest"
}
```

创建 DTO，字段如下：

```ts
// RegisterDto
username: string; // @IsString @MinLength(3) @MaxLength(32)
email: string; // @IsEmail
password: string; // @IsString @MinLength(8)
```

```ts
// LoginDto
account: string; // @IsString @MinLength(1)
password: string; // @IsString @MinLength(1)
```

```ts
// RefreshTokenDto
refreshToken: string; // @IsString @MinLength(20)
```

修改 `apps/api/src/main.ts`，加入：

```ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
  }),
);
```

- [ ] **步骤 4：实现认证服务和控制器**

实现 `AuthService` 公开方法：

```ts
register(dto: RegisterDto): Promise<AuthResponse>;
login(dto: LoginDto, ip: string): Promise<AuthResponse>;
refresh(refreshToken: string): Promise<AuthResponse>;
logout(refreshToken: string): Promise<{ success: true }>;
me(user: AuthenticatedUser): AuthenticatedUser;
```

`AuthResponse` 结构：

```ts
{
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken: string;
}
```

控制器路由：

```ts
POST /auth/register
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET /auth/me
```

登录失败 key 使用 `login_fail:{account}:{ip}`，五次失败锁定十五分钟。

- [ ] **步骤 5：实现 JWT guard**

`JwtAuthGuard` 需要：

- 读取 `Authorization: Bearer <token>`。
- 使用 `JwtService` 校验。
- 通过 `UsersService.findActiveById` 加载当前用户。
- 把 `AuthenticatedUser` 挂到 `request.user`。
- 对缺失或无效 token 抛出 `UnauthorizedException`。

- [ ] **步骤 6：验证 GREEN**

运行：

```bash
pnpm --filter @lingxi/api test -- auth.e2e-spec.ts
```

预期：通过。

- [ ] **步骤 7：提交**

```bash
git add apps/api/src/auth apps/api/src/app.module.ts apps/api/src/main.ts apps/api/package.json apps/api/test/auth.e2e-spec.ts pnpm-lock.yaml
git commit -m "feat(api): add auth endpoints"
```

---

### 任务 5：前端认证流程

**文件：**
- 创建：`apps/web/src/lib/auth-api.ts`
- 创建：`apps/web/src/lib/auth-storage.ts`
- 修改：`apps/web/src/app/login/page.tsx`
- 修改：`apps/web/src/app/register/page.tsx`
- 修改：`apps/web/src/app/dashboard/page.tsx`

**接口：**
- 产出 `login`、`register`、`refresh`、`logout` 和 `me` 的类型化前端调用。
- 产出真实登录和注册表单，成功后跳转到 `/dashboard`。
- 产出工作台身份展示和退出动作。

- [ ] **步骤 1：添加类型化 auth API helper**

创建 `apps/web/src/lib/auth-api.ts`：

```ts
export interface AuthUser {
  id: number;
  username: string;
  email: string;
  status: 'active' | 'disabled';
  isSuperAdmin: boolean;
  role: {
    code: string;
    name: string;
    level: number;
  };
}

export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

export async function login(input: { account: string; password: string }): Promise<AuthResponse>;
export async function register(input: { username: string; email: string; password: string }): Promise<AuthResponse>;
export async function getMe(accessToken: string): Promise<AuthUser>;
export async function logout(refreshToken: string): Promise<void>;
```

内部使用 `NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'`。

- [ ] **步骤 2：添加 token 保存 helper**

创建 `apps/web/src/lib/auth-storage.ts`：

```ts
export const ACCESS_TOKEN_KEY = 'lingxi_access_token';
export const REFRESH_TOKEN_KEY = 'lingxi_refresh_token';

export function saveAuthTokens(tokens: { accessToken: string; refreshToken: string }): void;
export function readAccessToken(): string | null;
export function readRefreshToken(): string | null;
export function clearAuthTokens(): void;
```

每个函数在 `typeof window === 'undefined'` 时都要安全返回。

- [ ] **步骤 3：把登录页改成客户端表单**

修改 `apps/web/src/app/login/page.tsx`：

- 添加 `'use client'`。
- 渲染账号和密码输入框。
- 调用 API 前校验必填字段。
- 使用 `saveAuthTokens` 保存 token。
- 使用 `useRouter` 跳转到 `/dashboard`。
- 保留到 `/register` 的链接。

- [ ] **步骤 4：把注册页改成客户端表单**

修改 `apps/web/src/app/register/page.tsx`：

- 添加 `'use client'`。
- 渲染用户名、邮箱、密码和确认密码输入框。
- 校验必填字段和两次密码一致。
- 调用 `register`。
- 保存 token 并跳转到 `/dashboard`。
- 保留回到 `/login` 的链接。

- [ ] **步骤 5：把工作台改成身份视图**

修改 `apps/web/src/app/dashboard/page.tsx`：

- 添加 `'use client'`。
- 从 storage 读取 access token。
- token 缺失时跳转到 `/login`。
- 调用 `getMe`。
- 展示用户名、角色名称、角色等级和超级管理员状态。
- 提供退出按钮：有 refresh token 时调用 `logout`，随后清理本地 storage 并跳转到 `/login`。

- [ ] **步骤 6：验证前端**

运行：

```bash
pnpm --filter @lingxi/web lint
pnpm --filter @lingxi/web build
```

预期：两个命令都退出码为 0。

- [ ] **步骤 7：提交**

```bash
git add apps/web/src/lib/auth-api.ts apps/web/src/lib/auth-storage.ts apps/web/src/app/login/page.tsx apps/web/src/app/register/page.tsx apps/web/src/app/dashboard/page.tsx
git commit -m "feat(web): add auth screens"
```

---

### 任务 6：最终验证和文档

**文件：**
- 修改：`README.md`
- 修改：`docs/superpowers/plans/2026-07-09-auth-rbac-foundation.md`
- 修改：`docs/superpowers/plans/2026-07-09-auth-rbac-foundation.zh-CN.md`

**接口：**
- 产出已验证的第二阶段基础。
- 记录本地认证环境变量和验证命令。

- [ ] **步骤 1：运行 API 验证**

运行：

```bash
pnpm --filter @lingxi/api prisma:generate
pnpm --filter @lingxi/api test
pnpm --filter @lingxi/api lint
```

预期：所有命令都退出码为 0。

- [ ] **步骤 2：运行 Web 验证**

运行：

```bash
pnpm --filter @lingxi/web lint
pnpm --filter @lingxi/web build
```

预期：两个命令都退出码为 0。

- [ ] **步骤 3：运行全项目构建**

运行：

```bash
pnpm build
```

预期：命令退出码为 0。

- [ ] **步骤 4：尝试验证 Docker 配置**

运行：

```bash
docker compose config
```

预期：有 Docker 的机器上命令退出码为 0。如果本地 Docker 不可用，在最终回复中记录该限制，不要声称 Docker 已验证。

- [ ] **步骤 5：更新 README**

在 `README.md` 增加简短认证说明：

```markdown
## Auth Environment

The auth phase needs these local variables in `.env`:

- `JWT_ACCESS_SECRET`
- `JWT_ACCESS_EXPIRES_IN`
- `REFRESH_TOKEN_SECRET`
- `REFRESH_TOKEN_EXPIRES_IN_DAYS`

Do not commit real secrets.
```

- [ ] **步骤 6：提交文档**

```bash
git add README.md docs/superpowers/plans/2026-07-09-auth-rbac-foundation.md docs/superpowers/plans/2026-07-09-auth-rbac-foundation.zh-CN.md
git commit -m "docs: verify auth rbac foundation"
```

---

## 自检说明

规格覆盖：

- 已覆盖：开放注册、登录、刷新、退出、`/auth/me`、默认 `qi_refining`、禁用用户拒绝、Redis Refresh Token 状态、Redis 登录失败状态、权限工具、真实前端表单、工作台身份展示。
- 有意延后：邮箱验证、密码找回、角色分配 UI、内容 CRUD、服务器入口 CRUD、两步验证和 admin bootstrap。

占位符扫描：

- 不应留下未解决的占位标记。
- 每个任务都写明了精确文件和验证命令。

类型一致性：

- `AuthenticatedUser` 是后端共享用户结构。
- `AuthResponse` 包含 `user`、`accessToken` 和 `refreshToken`。
- 前端 `AuthUser` 对应后端公开用户摘要。
- 默认注册角色 code 为 `qi_refining`。
