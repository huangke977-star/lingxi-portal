# Admin Bootstrap and User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the first super-admin account safely and add admin-only user role/status management.

**Architecture:** The API adds a bootstrap script and extends `UsersModule` with admin operations guarded by `SuperAdminGuard`. The web app replaces the placeholder `/admin` screen with a client-side user-management workspace that calls typed API helpers.

**Tech Stack:** NestJS, Next.js, TypeScript, Prisma, MySQL, Redis, pnpm.

## Global Constraints

- Do not print, commit, or document real admin passwords.
- Bootstrap input comes from `ADMIN_USERNAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
- User-management API authorization must require `isSuperAdmin = true`.
- Keep this phase limited to bootstrap and user role/status management.
- Maintain bilingual docs for project documentation.

---

## Tasks

### Task 1: Bootstrap Command

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/prisma/bootstrap-admin.ts`
- Test: `apps/api/test/admin-bootstrap.e2e-spec.ts`

**Steps:**
- [ ] Write a failing test proving bootstrap creates an `isSuperAdmin` user with the `administrator` role and updates the same user on rerun.
- [ ] Implement `bootstrap-admin.ts` with environment validation, password hashing, role lookup, and idempotent create/update.
- [ ] Add script `admin:bootstrap` to `apps/api/package.json`.
- [ ] Run `pnpm --filter @lingxi/api test -- admin-bootstrap.e2e-spec.ts`.
- [ ] Commit with `feat(api): add admin bootstrap command`.

### Task 2: Admin User API

**Files:**
- Modify: `apps/api/src/users/users.service.ts`
- Modify: `apps/api/src/users/users.module.ts`
- Create: `apps/api/src/users/users.controller.ts`
- Create: `apps/api/src/users/dto/update-user-role.dto.ts`
- Create: `apps/api/src/users/dto/update-user-status.dto.ts`
- Create: `apps/api/src/auth/guards/super-admin.guard.ts`
- Test: `apps/api/test/users-admin.e2e-spec.ts`

**Steps:**
- [ ] Write failing e2e tests for super-admin user list, role update, status update, and non-admin rejection.
- [ ] Implement `SuperAdminGuard`.
- [ ] Add `UsersController` routes: `GET /users`, `PATCH /users/:id/role`, `PATCH /users/:id/status`.
- [ ] Extend `UsersService` with `listUsers`, `assignRole`, and `setStatus`.
- [ ] Run `pnpm --filter @lingxi/api test -- users-admin.e2e-spec.ts`.
- [ ] Commit with `feat(api): add admin user management`.

### Task 3: Admin Web Screen

**Files:**
- Modify: `apps/web/src/lib/auth-api.ts`
- Create: `apps/web/src/lib/admin-api.ts`
- Modify: `apps/web/src/app/admin/page.tsx`
- Modify: `apps/web/src/app/globals.css`

**Steps:**
- [ ] Add typed admin API helpers for users, roles, role update, and status update.
- [ ] Replace `/admin` placeholder with a client-side super-admin user table.
- [ ] Keep copy utility-focused and avoid exposing passwords or secrets.
- [ ] Run `pnpm --filter @lingxi/web lint` and `pnpm --filter @lingxi/web build`.
- [ ] Commit with `feat(web): add admin user management`.

### Task 4: Verification and Server Test

**Files:**
- Modify: `README.md`

**Steps:**
- [ ] Document the bootstrap environment variables in README.
- [ ] Run `pnpm --filter @lingxi/api prisma:generate`.
- [ ] Run `pnpm --filter @lingxi/api test`.
- [ ] Run `pnpm --filter @lingxi/api lint`.
- [ ] Run `pnpm --filter @lingxi/web lint`.
- [ ] Run `pnpm build`.
- [ ] Push `main`.
- [ ] Connect to the server using existing private credentials, pull the repo, run migrations, run bootstrap with secrets, start the stack, and test login/admin APIs without printing secrets.

## Self-Review Notes

- Covered: bootstrap, super-admin guard, user list, role assignment, status updates, admin screen, README variables, local and server verification.
- Deferred: role CRUD, server-entry CRUD, navigation/page/tool management, password reset, email verification.
- No real credentials are included in this plan.
