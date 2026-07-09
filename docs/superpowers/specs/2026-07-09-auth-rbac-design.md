# Authentication and RBAC Foundation Design

Date: 2026-07-09

## Goal

Build the second phase of Lingxi Portal: a real authentication and role-permission foundation that future navigation, page, tool, server-entry, and admin modules can reuse.

This phase should make identity real before adding more content-management features. A user should be able to register, log in, refresh a session, log out, and fetch their current profile. The backend should be able to decide whether the current user is logged in, which role they have, whether they are the system `admin`, and whether they satisfy a minimum role level.

## Scope

This phase includes:

- Open registration.
- Password login.
- Access token and refresh token issuing.
- Refresh token rotation.
- Logout for the current session.
- Current-user endpoint.
- Redis-backed refresh token state.
- Redis-backed login failure protection.
- Default `练气` role for new users.
- Super-admin support for the `admin` account.
- Shared role-level permission helpers for later modules.
- Real frontend login and registration forms.
- Dashboard identity display after login.

This phase does not include:

- Email verification.
- Email password reset.
- Full user-management screens.
- Role assignment UI.
- Navigation, page, tool, or server-entry CRUD.
- Third-party OAuth login.
- Multi-factor authentication.
- Long-term audit-log UI.

## Architecture

The API remains a NestJS application. Authentication is isolated in `AuthModule`; user lookup and future user-management behavior are isolated in `UsersModule`; role data remains in `RolesModule`; Prisma access remains behind `PrismaService`.

The frontend remains a Next.js application. Login and registration pages call the API through typed helper functions. The browser stores the short-lived access token in client state or web storage for the first implementation, while the refresh token is kept in an HTTP-only cookie when the API and browser deployment shape allows it. If local development cannot use secure cookies cleanly, the implementation may temporarily use explicit refresh-token payloads, but the API contract must keep refresh-token storage replaceable.

Redis stores short-lived security state only. MySQL remains the source of truth for users, roles, and user status.

## Database Model

Extend the Prisma schema with a `User` model:

- `id`: integer primary key.
- `username`: unique string, 3 to 32 characters.
- `email`: unique string, normalized to lower case.
- `passwordHash`: password hash, never plaintext.
- `roleId`: required role relation.
- `isSuperAdmin`: boolean, default `false`.
- `status`: enum with `active` and `disabled`.
- `lastLoginAt`: nullable datetime.
- `createdAt`: datetime.
- `updatedAt`: datetime.

Extend `Role` with a `users` relation. The existing nine seeded roles remain the assignable role set. New users receive `qi_refining` (`练气`, level 10).

The `admin` account is identified by `isSuperAdmin = true`. It should also have the `administrator` role for consistency, but super-admin permission does not depend on role level.

## Redis State

Redis keys:

- `refresh_token:{tokenId}`: stores user id, token hash, issued-at time, expiry time, and revoked flag if needed.
- `user_sessions:{userId}`: set of active token ids for the user.
- `login_fail:{username}:{ip}`: failed login counter with TTL.

Refresh token rules:

- Refresh tokens are random opaque strings.
- Redis stores only a hash of the refresh token.
- Refreshing a token invalidates the old token id and creates a new token id.
- Logout deletes the current refresh token id and removes it from the user session set.
- Disabled users cannot refresh.

Login failure rules:

- Failed logins increment `login_fail:{username}:{ip}`.
- Five failed attempts within fifteen minutes block login for that username and IP until the TTL expires.
- Successful login clears the failure counter.

## API Contract

Base route prefix remains the existing API server root.

Endpoints:

- `POST /auth/register`
  - Input: `username`, `email`, `password`.
  - Output: user summary, access token, refresh token or refresh cookie metadata.
  - Behavior: creates an active user with default role `qi_refining`.

- `POST /auth/login`
  - Input: `account`, `password`, where account may be username or email.
  - Output: user summary, access token, refresh token or refresh cookie metadata.
  - Behavior: rejects disabled users and invalid credentials.

- `POST /auth/refresh`
  - Input: refresh token from cookie or body, depending on deployment mode.
  - Output: new access token and rotated refresh token.
  - Behavior: rejects missing, expired, revoked, or mismatched refresh tokens.

- `POST /auth/logout`
  - Auth: refresh token required.
  - Output: success flag.
  - Behavior: deletes the current refresh token session.

- `GET /auth/me`
  - Auth: access token required.
  - Output: current user summary with role code, role name, role level, and `isSuperAdmin`.

User summary fields:

- `id`
- `username`
- `email`
- `status`
- `isSuperAdmin`
- `role.code`
- `role.name`
- `role.level`

## Permission Rules

The backend should expose reusable permission helpers:

- `isAuthenticated(user)`: true when a valid access token resolves to an active user.
- `isSuperAdmin(user)`: true when `isSuperAdmin` is true.
- `hasRoleLevel(user, minLevel)`: true for super admin or active users whose role level is at least `minLevel`.
- `canViewServerEntries(user)`: true for super admin or role level at least 90.
- `canManageServerEntries(user)`: true only for super admin.

The frontend may hide unavailable links, but backend guards remain authoritative.

## Frontend Behavior

Login page:

- Accept account and password.
- Shows field-level validation for missing input.
- Calls `POST /auth/login`.
- Stores the returned access token through the local auth helper.
- Redirects to `/dashboard` after successful login.
- Shows a concise error for invalid credentials or temporary lockout.

Registration page:

- Accept username, email, password, and password confirmation.
- Validates password confirmation client-side.
- Calls `POST /auth/register`.
- Logs the user in after registration.
- Redirects to `/dashboard`.

Dashboard:

- Calls `GET /auth/me`.
- Shows username, role name, role level, and whether the user is super admin.
- Shows a logout action.
- Does not expose server-entry configuration yet.

## Error Handling

API validation errors should use stable messages and HTTP status codes:

- `400`: invalid request body.
- `401`: invalid credentials, missing token, expired token, or invalid token.
- `403`: disabled user, temporary lockout, or insufficient permission.
- `409`: username or email already exists.

The frontend should display human-readable messages without leaking whether a registered account exists beyond what registration uniqueness errors already reveal.

## Security Notes

- Passwords must be hashed with Argon2id or bcrypt using current safe defaults.
- Plaintext passwords and plaintext refresh tokens must never be stored in MySQL or Redis.
- JWT signing secret comes from `.env`.
- Refresh token hashing secret or salt comes from `.env`.
- `.env` remains ignored by git.
- No secrets should be written into documentation or chat.
- CORS should allow the configured frontend origin only in production.

## Testing Strategy

Backend tests should cover:

- Registration creates a user with role `qi_refining`.
- Duplicate username or email is rejected.
- Login succeeds with username or email.
- Login rejects wrong passwords.
- Disabled users cannot log in or refresh.
- Refresh rotates token state.
- Logout removes the current refresh token state.
- `/auth/me` returns the current user with role fields.
- Role helper functions allow super admin, allow sufficient role level, and reject insufficient role level.
- Login failure protection blocks repeated failures.

Frontend verification should cover:

- TypeScript build.
- ESLint.
- Manual browser flow after API implementation: register, dashboard identity display, logout, login again.

## Deployment Notes

Docker Compose already includes MySQL and Redis. This phase requires these environment variables:

- `JWT_ACCESS_SECRET`
- `JWT_ACCESS_EXPIRES_IN`
- `REFRESH_TOKEN_SECRET`
- `REFRESH_TOKEN_EXPIRES_IN_DAYS`
- `COOKIE_SECRET` if cookie mode is used.
- `WEB_ORIGIN`

The first super-admin account should be created through a one-time bootstrap command in a later admin-bootstrap task. If this phase needs a test admin, it should create the user only in test setup or seed scripts, not by hard-coding credentials in source.

## Acceptance Criteria

- A fresh user can register and receives role `练气`.
- A registered user can log in, refresh, log out, and fetch `/auth/me`.
- Disabled users are rejected by protected auth flows.
- Refresh tokens are stored hashed in Redis and rotate on refresh.
- Repeated failed logins are temporarily blocked.
- Permission helpers are reusable by later content modules.
- Login and registration pages use real API calls.
- The project still passes API tests, API lint, web lint, and production build.
