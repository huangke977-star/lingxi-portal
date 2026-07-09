# Admin Bootstrap and User Management Design

Date: 2026-07-09

## Goal

Add the first administrative slice after authentication: a safe way to create the first super-admin account, plus a minimal admin-only user management surface for listing users, changing roles, and enabling or disabling accounts.

## Scope

This phase includes:

- A one-time CLI bootstrap command for creating or updating the `admin` super-admin account.
- Environment-driven bootstrap input: username, email, and password.
- Admin-only API endpoints for listing users, assigning roles, and changing user status.
- Backend guards that require `isSuperAdmin = true`.
- A real `/admin` frontend screen that uses the access token from login and calls the user-management APIs.
- Tests for bootstrap behavior, super-admin guards, user listing, role assignment, and status changes.

This phase excludes:

- Public registration changes.
- Password reset.
- User self-service profile editing.
- Role CRUD.
- Server-entry CRUD.
- Navigation, page, and tool management.
- Storing secrets in source, docs, or chat.

## Design

The bootstrap command runs inside the API package and uses existing services where practical. It reads `ADMIN_USERNAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` from environment variables, hashes the password, assigns the `administrator` role, and sets `isSuperAdmin = true`. It is idempotent: if the username or email already exists, it updates that user into the super-admin account instead of creating duplicates.

User management stays behind backend authorization. `GET /users` returns public user summaries with role fields. `PATCH /users/:id/role` accepts a role code and updates the user's role. `PATCH /users/:id/status` accepts `active` or `disabled`. Only super admin can call these routes.

The frontend `/admin` page remains a restrained operations screen. It reads the local access token, loads the current user, rejects non-super-admin users with a clear message, loads roles and users, and provides role/status controls. It does not show or store passwords.

## Security Rules

- The bootstrap password comes only from environment variables or deployment secrets.
- The command must not print passwords or token values.
- API authorization must happen on the backend, not just by hiding frontend controls.
- Only `isSuperAdmin = true` can list users, assign roles, or change statuses.
- The frontend must not persist any admin-only secret beyond the existing access token.

## Acceptance Criteria

- `pnpm --filter @lingxi/api admin:bootstrap` creates an `admin` super-admin user when the required env vars are present.
- Running the bootstrap command again updates the existing admin instead of creating duplicates.
- Super admin can list users, assign a user to any seeded role, and enable or disable users.
- Non-super-admin users cannot access user-management APIs.
- `/admin` uses real APIs and shows a usable user-management table.
- API tests, API lint, web lint, and production build pass.
