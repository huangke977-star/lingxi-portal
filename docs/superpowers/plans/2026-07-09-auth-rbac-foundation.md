# Authentication and RBAC Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real registration, login, refresh-token sessions, logout, current-user lookup, and reusable role permission helpers to Lingxi Portal.

**Architecture:** The backend adds `UsersModule`, `AuthModule`, and `RedisModule` while keeping Prisma as the database boundary. Access tokens are JWTs; refresh tokens are opaque random values stored as hashes in Redis. The frontend replaces placeholder login/register pages with client forms that call typed API helpers and show the logged-in identity on `/dashboard`.

**Tech Stack:** NestJS, Next.js, TypeScript, Prisma, MySQL 8.4, Redis, `@nestjs/jwt`, `bcryptjs`, `ioredis`, pnpm.

## Global Constraints

- Keep frontend and backend separated under `apps/web` and `apps/api`.
- Store durable user and role data in MySQL through Prisma.
- Store refresh token state and login failure counters in Redis only.
- Never store plaintext passwords or plaintext refresh tokens in MySQL, Redis, docs, source, or chat.
- New registered users default to role code `qi_refining`.
- `isSuperAdmin = true` bypasses role-level checks.
- Role level 90 can view server entries; only super admin can manage server entries.
- Do not implement navigation, page, tool, server-entry CRUD, role-assignment UI, email verification, or two-factor authentication in this phase.
- Maintain bilingual docs for new project documentation.

---

## Scope Check

This plan implements only the auth and role-permission foundation from `docs/superpowers/specs/2026-07-09-auth-rbac-design.md`. It intentionally excludes content CRUD and admin screens so the identity layer can be verified before later modules depend on it.

## Target File Structure

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

Responsibilities:

- `UsersService` owns user lookup, creation, and status-aware current-user loading.
- `AuthService` orchestrates register, login, refresh, logout, and `/me`.
- `PasswordService` owns password hashing and comparison.
- `RefreshTokenService` owns opaque refresh token generation, hashing, Redis storage, rotation, and logout removal.
- `RedisService` wraps `ioredis` and exposes only the small command surface needed by auth.
- `permissions.ts` exposes pure role checks for later modules and fast unit tests.
- `auth-api.ts` and `auth-storage.ts` isolate browser API calls and token persistence from React pages.

---

### Task 1: User Schema and Auth Dependencies

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260709090000_add_auth_users/migration.sql`
- Modify: `.env.example`
- Modify: `docker-compose.yml`

**Interfaces:**
- Produces Prisma `User` model and `UserStatus` enum.
- Adds runtime dependencies used by later tasks: `@nestjs/jwt`, `bcryptjs`, `ioredis`.
- Adds env keys consumed by auth services: `JWT_ACCESS_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `REFRESH_TOKEN_SECRET`, `REFRESH_TOKEN_EXPIRES_IN_DAYS`.

- [ ] **Step 1: Write schema expectation**

Create or update a temporary local note for the migration target before editing production code:

```text
User fields: id, username, email, passwordHash, roleId, isSuperAdmin, status, lastLoginAt, createdAt, updatedAt.
Role relation: Role.users.
UserStatus enum: active, disabled.
```

- [ ] **Step 2: Update dependencies**

Add to `apps/api/package.json` dependencies:

```json
{
  "@nestjs/jwt": "latest",
  "bcryptjs": "latest",
  "ioredis": "latest"
}
```

No additional `bcryptjs` type package is needed because `bcryptjs` ships its own types.

- [ ] **Step 3: Extend Prisma schema**

Modify `apps/api/prisma/schema.prisma`:

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

- [ ] **Step 4: Add SQL migration**

Create `apps/api/prisma/migrations/20260709090000_add_auth_users/migration.sql`:

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

- [ ] **Step 5: Extend env templates**

Ensure `.env.example` contains:

```dotenv
JWT_ACCESS_SECRET=change-me-access-secret
JWT_ACCESS_EXPIRES_IN=15m
REFRESH_TOKEN_SECRET=change-me-refresh-token-secret
REFRESH_TOKEN_EXPIRES_IN_DAYS=30
```

Ensure `docker-compose.yml` passes those variables to the `api` service.

- [ ] **Step 6: Install and generate**

Run:

```bash
pnpm install
pnpm --filter @lingxi/api prisma:generate
```

Expected: Prisma Client generation exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260709090000_add_auth_users/migration.sql .env.example docker-compose.yml pnpm-lock.yaml
git commit -m "feat(api): add user auth schema"
```

---

### Task 2: Permission Helpers

**Files:**
- Create: `apps/api/src/auth/auth.types.ts`
- Create: `apps/api/src/auth/permissions.ts`
- Create: `apps/api/test/permissions.e2e-spec.ts`

**Interfaces:**
- Produces `AuthenticatedUser`.
- Produces `isSuperAdmin`, `hasRoleLevel`, `canViewServerEntries`, and `canManageServerEntries`.

- [ ] **Step 1: Write failing permission tests**

Create `apps/api/test/permissions.e2e-spec.ts`:

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

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @lingxi/api test -- permissions.e2e-spec.ts
```

Expected: FAIL because `../src/auth/permissions` does not exist.

- [ ] **Step 3: Implement permission helpers**

Create `apps/api/src/auth/auth.types.ts`:

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

Create `apps/api/src/auth/permissions.ts`:

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

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @lingxi/api test -- permissions.e2e-spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/auth.types.ts apps/api/src/auth/permissions.ts apps/api/test/permissions.e2e-spec.ts
git commit -m "feat(api): add role permission helpers"
```

---

### Task 3: Users, Redis, Password, and Refresh Token Services

**Files:**
- Create: `apps/api/src/users/users.module.ts`
- Create: `apps/api/src/users/users.service.ts`
- Create: `apps/api/src/redis/redis.module.ts`
- Create: `apps/api/src/redis/redis.service.ts`
- Create: `apps/api/src/auth/password.service.ts`
- Create: `apps/api/src/auth/refresh-token.service.ts`
- Create: `apps/api/test/auth-services.e2e-spec.ts`

**Interfaces:**
- Produces `UsersService.createUser`, `findForLogin`, `findActiveById`, and `markLoginSuccess`.
- Produces `PasswordService.hashPassword` and `verifyPassword`.
- Produces `RefreshTokenService.issue`, `rotate`, and `revoke`.

- [ ] **Step 1: Write failing service tests**

Create `apps/api/test/auth-services.e2e-spec.ts` with tests that instantiate services against fake Prisma and fake Redis:

```ts
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @lingxi/api test -- auth-services.e2e-spec.ts
```

Expected: FAIL because the services do not exist.

- [ ] **Step 3: Implement service files**

Implement the service files with these exact public methods:

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

Implementation rules:

- Use bcrypt cost `12`.
- Normalize email to lower case in `UsersService.createUser`.
- Find login accounts by `OR: [{ username: account }, { email: account.toLowerCase() }]`.
- Use token format `${tokenId}.${secret}`.
- Hash refresh tokens with `HMAC-SHA256` using `REFRESH_TOKEN_SECRET`.
- Store refresh token records as JSON at `refresh_token:{tokenId}`.
- Track active token ids in `user_sessions:{userId}`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @lingxi/api test -- auth-services.e2e-spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/users apps/api/src/redis apps/api/src/auth/password.service.ts apps/api/src/auth/refresh-token.service.ts apps/api/test/auth-services.e2e-spec.ts
git commit -m "feat(api): add auth support services"
```

---

### Task 4: Auth API and JWT Guard

**Files:**
- Create: `apps/api/src/auth/dto/register.dto.ts`
- Create: `apps/api/src/auth/dto/login.dto.ts`
- Create: `apps/api/src/auth/dto/refresh-token.dto.ts`
- Create: `apps/api/src/auth/current-user.decorator.ts`
- Create: `apps/api/src/auth/guards/jwt-auth.guard.ts`
- Create: `apps/api/src/auth/auth.service.ts`
- Create: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/main.ts`
- Create: `apps/api/test/auth.e2e-spec.ts`

**Interfaces:**
- Produces `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, and `GET /auth/me`.
- Produces bearer-token guard used by `/auth/me`.

- [ ] **Step 1: Write failing API tests**

Create `apps/api/test/auth.e2e-spec.ts` covering:

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

Use `Test.createTestingModule({ imports: [AppModule] })`, override `PrismaService` with in-memory user/role behavior, and override `RedisService` with in-memory key/value and set behavior. Apply the same `ValidationPipe` used in `main.ts` before `app.init()`.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @lingxi/api test -- auth.e2e-spec.ts
```

Expected: FAIL because `AuthModule` and routes do not exist.

- [ ] **Step 3: Implement DTOs and validation**

Install validation dependencies if missing:

```json
{
  "class-transformer": "latest",
  "class-validator": "latest"
}
```

Create DTOs with these fields:

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

Modify `apps/api/src/main.ts` to use:

```ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
  }),
);
```

- [ ] **Step 4: Implement auth service and controller**

Implement `AuthService` public methods:

```ts
register(dto: RegisterDto): Promise<AuthResponse>;
login(dto: LoginDto, ip: string): Promise<AuthResponse>;
refresh(refreshToken: string): Promise<AuthResponse>;
logout(refreshToken: string): Promise<{ success: true }>;
me(user: AuthenticatedUser): AuthenticatedUser;
```

`AuthResponse` shape:

```ts
{
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken: string;
}
```

Controller routes:

```ts
POST /auth/register
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET /auth/me
```

Login failure keys use `login_fail:{account}:{ip}` with five-attempt lockout and fifteen-minute TTL.

- [ ] **Step 5: Implement JWT guard**

`JwtAuthGuard` should:

- Read `Authorization: Bearer <token>`.
- Verify with `JwtService`.
- Load current user through `UsersService.findActiveById`.
- Attach `AuthenticatedUser` to `request.user`.
- Throw `UnauthorizedException` for missing or invalid tokens.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
pnpm --filter @lingxi/api test -- auth.e2e-spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/auth apps/api/src/app.module.ts apps/api/src/main.ts apps/api/package.json apps/api/test/auth.e2e-spec.ts pnpm-lock.yaml
git commit -m "feat(api): add auth endpoints"
```

---

### Task 5: Frontend Auth Flow

**Files:**
- Create: `apps/web/src/lib/auth-api.ts`
- Create: `apps/web/src/lib/auth-storage.ts`
- Modify: `apps/web/src/app/login/page.tsx`
- Modify: `apps/web/src/app/register/page.tsx`
- Modify: `apps/web/src/app/dashboard/page.tsx`

**Interfaces:**
- Produces typed frontend calls for `login`, `register`, `refresh`, `logout`, and `me`.
- Produces real login and registration forms that redirect to `/dashboard`.
- Produces dashboard identity display and logout action.

- [ ] **Step 1: Add typed auth API helper**

Create `apps/web/src/lib/auth-api.ts`:

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

Use `NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'` internally.

- [ ] **Step 2: Add token storage helper**

Create `apps/web/src/lib/auth-storage.ts`:

```ts
export const ACCESS_TOKEN_KEY = 'lingxi_access_token';
export const REFRESH_TOKEN_KEY = 'lingxi_refresh_token';

export function saveAuthTokens(tokens: { accessToken: string; refreshToken: string }): void;
export function readAccessToken(): string | null;
export function readRefreshToken(): string | null;
export function clearAuthTokens(): void;
```

Each function must return safely when `typeof window === 'undefined'`.

- [ ] **Step 3: Convert login page to a client form**

Modify `apps/web/src/app/login/page.tsx` to:

- Add `'use client'`.
- Render account and password inputs.
- Validate required fields before calling API.
- Save tokens with `saveAuthTokens`.
- Redirect to `/dashboard` with `useRouter`.
- Link to `/register`.

- [ ] **Step 4: Convert registration page to a client form**

Modify `apps/web/src/app/register/page.tsx` to:

- Add `'use client'`.
- Render username, email, password, and confirmation inputs.
- Validate required fields and matching passwords.
- Call `register`.
- Save tokens and redirect to `/dashboard`.
- Link back to `/login`.

- [ ] **Step 5: Convert dashboard page to identity view**

Modify `apps/web/src/app/dashboard/page.tsx` to:

- Add `'use client'`.
- Read access token from storage.
- Redirect to `/login` when missing.
- Call `getMe`.
- Show username, role name, role level, and super-admin state.
- Provide logout button that calls `logout` when refresh token exists, clears local storage, then redirects to `/login`.

- [ ] **Step 6: Verify frontend**

Run:

```bash
pnpm --filter @lingxi/web lint
pnpm --filter @lingxi/web build
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/auth-api.ts apps/web/src/lib/auth-storage.ts apps/web/src/app/login/page.tsx apps/web/src/app/register/page.tsx apps/web/src/app/dashboard/page.tsx
git commit -m "feat(web): add auth screens"
```

---

### Task 6: Final Verification and Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-09-auth-rbac-foundation.md`
- Modify: `docs/superpowers/plans/2026-07-09-auth-rbac-foundation.zh-CN.md`

**Interfaces:**
- Produces a verified Phase 2 foundation.
- Documents local auth environment variables and verification commands.

- [ ] **Step 1: Run API verification**

Run:

```bash
pnpm --filter @lingxi/api prisma:generate
pnpm --filter @lingxi/api test
pnpm --filter @lingxi/api lint
```

Expected: all commands exit 0.

- [ ] **Step 2: Run web verification**

Run:

```bash
pnpm --filter @lingxi/web lint
pnpm --filter @lingxi/web build
```

Expected: both commands exit 0.

- [ ] **Step 3: Run whole-project build**

Run:

```bash
pnpm build
```

Expected: command exits 0.

- [ ] **Step 4: Attempt Docker config verification**

Run:

```bash
docker compose config
```

Expected on machines with Docker: command exits 0. If Docker is unavailable locally, record that limitation in the final response instead of claiming Docker verification.

- [ ] **Step 5: Update README**

Add a short auth section to `README.md` that documents:

```markdown
## Auth Environment

The auth phase needs these local variables in `.env`:

- `JWT_ACCESS_SECRET`
- `JWT_ACCESS_EXPIRES_IN`
- `REFRESH_TOKEN_SECRET`
- `REFRESH_TOKEN_EXPIRES_IN_DAYS`

Do not commit real secrets.
```

- [ ] **Step 6: Commit docs**

```bash
git add README.md docs/superpowers/plans/2026-07-09-auth-rbac-foundation.md docs/superpowers/plans/2026-07-09-auth-rbac-foundation.zh-CN.md
git commit -m "docs: verify auth rbac foundation"
```

---

## Self-Review Notes

Spec coverage:

- Covered: open registration, login, refresh, logout, `/auth/me`, default `qi_refining`, disabled-user rejection, Redis refresh token state, Redis login failure state, permission helpers, real frontend forms, dashboard identity display.
- Deferred intentionally: email verification, password reset, role assignment UI, content CRUD, server-entry CRUD, two-factor authentication, and admin bootstrap.

Placeholder scan:

- No unresolved placeholder markers should remain.
- Every task names exact files and verification commands.

Type consistency:

- `AuthenticatedUser` is the shared backend user shape.
- `AuthResponse` contains `user`, `accessToken`, and `refreshToken`.
- Frontend `AuthUser` mirrors the public backend user summary.
- Role code for default registration is `qi_refining`.
