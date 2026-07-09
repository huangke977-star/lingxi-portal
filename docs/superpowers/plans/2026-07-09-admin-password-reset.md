# Super Admin User Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the super admin to change any account password from the admin dashboard while keeping user deletion unavailable.

**Architecture:** The API adds a password update route inside the existing `UsersModule`, protected by `SuperAdminGuard`, and reuses `PasswordService` to hash passwords. The Web app adds a password reset modal to the existing `/admin` user table without adding deletion capability.

**Tech Stack:** NestJS, Next.js, TypeScript, Prisma, bcryptjs, pnpm.

## Global Constraints

- Only accounts with `isSuperAdmin = true` can change any user password.
- An ordinary `administrator` role without super admin status cannot change passwords.
- Passwords must be at least 8 characters.
- Responses must not include `passwordHash`.
- Do not add a delete endpoint or delete button.
- Project documentation stays bilingual in English and Chinese.

---

## Task 1: API Password Update Route

**Files:**
- Create: `apps/api/src/users/dto/update-user-password.dto.ts`
- Modify: `apps/api/src/users/users.controller.ts`
- Modify: `apps/api/src/users/users.service.ts`
- Modify: `apps/api/src/users/users.module.ts`
- Test: `apps/api/test/users-admin.e2e-spec.ts`

**Interfaces:**
- Input: `PATCH /users/:id/password` with body `{ password: string }`
- Output: `AuthenticatedUser`

**Steps:**
- [ ] Add a failing test to `users-admin.e2e-spec.ts`: a super admin can update a user's password, the stored `passwordHash` changes, and the response omits `passwordHash`.
- [ ] Run `pnpm --filter @lingxi/api test -- users-admin.e2e-spec.ts`; expect failure because the route does not exist yet.
- [ ] Add a failing test: a normal user calling `PATCH /users/1/password` receives 403.
- [ ] Add a failing test: a short password returns 400.
- [ ] Create `UpdateUserPasswordDto` with `@IsString()` and `@MinLength(8)` on `password`.
- [ ] Inject `PasswordService` into `UsersService` and add `updatePassword(id: number, password: string): Promise<AuthenticatedUser>`.
- [ ] Add `@Patch(':id/password')` to `UsersController`.
- [ ] Add `PasswordService` to `UsersModule` providers.
- [ ] Run `pnpm --filter @lingxi/api test -- users-admin.e2e-spec.ts`; expect pass.

## Task 2: Web Admin Button And Modal

**Files:**
- Modify: `apps/web/src/lib/admin-api.ts`
- Modify: `apps/web/src/app/admin/page.tsx`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**
- `updateUserPassword(accessToken: string, userId: number, password: string): Promise<AuthUser>`

**Steps:**
- [ ] Add `updateUserPassword` to `admin-api.ts`.
- [ ] Add modal state to `/admin`: target user, new password, confirmation password, and submit state.
- [ ] Add a "修改密码" button to each row's action area; do not add a delete button.
- [ ] Validate password length and matching confirmation before submit.
- [ ] On success, close the modal, clear inputs, and show a success notice.
- [ ] Add CSS for action grouping, modal layout, and modal form controls.
- [ ] Run `pnpm --filter @lingxi/web lint`.
- [ ] Run `pnpm --filter @lingxi/web build`.

## Task 3: Full Verification, Commit, Deploy

**Files:**
- Verify all modified files.

**Steps:**
- [ ] Run `pnpm --filter @lingxi/api test`.
- [ ] Run `pnpm --filter @lingxi/api lint`.
- [ ] Run `pnpm --filter @lingxi/web lint`.
- [ ] Run `pnpm --filter @lingxi/web build`.
- [ ] Run `pnpm build`.
- [ ] Commit and push.
- [ ] After GitHub Actions builds images, deploy by pulling images and running compose on the server; do not build on the server.
- [ ] Test `https://5200918.xyz/admin`: login works, the password reset button is present, and no delete button exists.

## Self-Review Notes

- The plan covers backend authorization, password validation, hash storage, response redaction, and frontend entry points.
- User deletion and ordinary-user self-service password change are explicitly out of scope.
- Documentation contains no real credentials.
