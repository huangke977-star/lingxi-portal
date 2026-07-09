# Personal Portal Platform Design

Date: 2026-07-09

## Goal

Build `5200918.xyz` as a personal portal platform. Public visitors see a clean homepage, public navigation, and public pages. After login, users see a role-aware workspace with private navigation, available pages, tools, and permitted server entries.

The first version should establish a stable foundation rather than a one-off navigation page. It must support open registration, role assignment, public/private content, and future custom pages and tools.

## Product Shape

The site uses a mixed public/private model:

- Public mode: homepage, public navigation, public pages, and public tool entry points.
- Logged-in mode: personal workspace, role-gated content, private links, and allowed tools.
- Admin mode: management pages for users, roles, categories, links, pages, tools, server entries, and site settings.

The first version focuses on backend management and navigation. Markdown pages and tools are included as simple foundations so future features can be added without changing the architecture.

## Technical Stack

- Frontend: Next.js, TypeScript, Tailwind CSS, shadcn/ui.
- Backend: NestJS, TypeScript.
- Database: MySQL 8.4 LTS.
- ORM and migrations: Prisma.
- Session and rate state: Redis.
- Deployment: Docker Compose.
- Reverse proxy: Nginx or Caddy.

Port allocation:

- `80`: HTTP, redirect to HTTPS.
- `443`: website HTTPS.
- `8443`: Shadowsocks proxy node.
- `8388`: Shadowsocks legacy node, retained for now.

## Services

The deployment contains these containers:

- `portal-frontend`: Next.js web app.
- `portal-backend`: NestJS API service.
- `portal-mysql`: MySQL 8.4 LTS.
- `portal-redis`: Redis for auth/session/rate state.
- `portal-proxy`: optional Nginx/Caddy reverse proxy if not using host-level proxy.

1Panel can manage the containers and backups, but the app itself should be source-controlled and deployable through Docker Compose.

## Permission Model

There are two permission concepts: a system super-admin flag and role levels.

The `admin` account is the system super administrator. It can configure everything, assign roles, disable users, and manage server entries.

Assignable roles:

| Role | Level |
| --- | ---: |
| 练气 | 10 |
| 筑基 | 20 |
| 金丹 | 30 |
| 元婴 | 40 |
| 化神 | 50 |
| 炼虚 | 60 |
| 合体 | 70 |
| 大乘 | 80 |
| 管理员 | 90 |

Rules:

- Open registration is enabled.
- New users default to role `练气`.
- Only `admin` can assign or change roles.
- `管理员` role can view server entries.
- Only `admin` can configure server entries.
- `admin` bypasses role-level checks.

## Content Visibility

Resources use both visibility and minimum role:

- `public`: visible to everyone.
- `private`: login required, then role level must satisfy `min_role_level`.

Examples:

- Public navigation: `visibility = public`, `min_role_level = null`.
- Login-only content: `visibility = private`, `min_role_level = 10`.
- Gold-core-level content: `visibility = private`, `min_role_level = 30`.
- Server entries: `visibility = private`, `min_role_level = 90`, configurable only by `admin`.

Owner-specific private content can use `owner_id`. In MVP, owner-specific visibility is optional for admin-created resources; the schema should keep the field so personal content can be added later.

## Routes

Public frontend routes:

- `/`: public homepage.
- `/nav`: public navigation.
- `/pages/[slug]`: public or permitted page detail.
- `/tools`: public tool directory.
- `/login`: login page.
- `/register`: registration page.

Logged-in routes:

- `/dashboard`: role-aware workspace.
- `/dashboard/nav`: visible navigation.
- `/dashboard/pages`: visible pages.
- `/dashboard/tools`: visible tools.
- `/dashboard/servers`: server entries, visible to `admin` and role `管理员`.

Admin routes:

- `/admin/users`: user list, role assignment, user status.
- `/admin/categories`: category management.
- `/admin/links`: link management.
- `/admin/pages`: Markdown page management.
- `/admin/tools`: tool entry management.
- `/admin/servers`: server entry management, only `admin`.
- `/admin/settings`: site settings.

## Database Model

Core tables:

- `users`
- `roles`
- `categories`
- `links`
- `pages`
- `tools`
- `server_entries`
- `settings`
- `operation_logs`

Suggested fields:

`users`

- `id`
- `username`
- `email`
- `password_hash`
- `role_id`
- `is_super_admin`
- `status`: `active`, `disabled`
- `created_at`
- `updated_at`
- `last_login_at`

`roles`

- `id`
- `code`
- `name`
- `level`
- `sort_order`

Seed roles are the nine assignable roles listed in the permission model.

`categories`

- `id`
- `name`
- `slug`
- `type`: `link`, `page`, `tool`, `server`
- `visibility`: `public`, `private`
- `min_role_level`
- `owner_id`
- `sort_order`
- `is_enabled`
- `created_at`
- `updated_at`

`links`

- `id`
- `category_id`
- `title`
- `url`
- `description`
- `icon`
- `visibility`
- `min_role_level`
- `owner_id`
- `sort_order`
- `is_enabled`
- `created_at`
- `updated_at`

`pages`

- `id`
- `title`
- `slug`
- `summary`
- `content_markdown`
- `visibility`
- `min_role_level`
- `owner_id`
- `is_published`
- `published_at`
- `created_at`
- `updated_at`

`tools`

- `id`
- `name`
- `slug`
- `description`
- `icon`
- `entry_path`
- `visibility`
- `min_role_level`
- `is_enabled`
- `created_at`
- `updated_at`

`server_entries`

- `id`
- `name`
- `entry_url`
- `description`
- `host`
- `port`
- `protocol`
- `visibility`
- `min_role_level`
- `sort_order`
- `is_enabled`
- `created_at`
- `updated_at`

Server entry sensitive fields should not store passwords or private keys. Secrets stay in the existing local secret file or a later dedicated secret manager.

`settings`

- `id`
- `key`
- `value`
- `value_type`
- `updated_at`

`operation_logs`

- `id`
- `actor_user_id`
- `action`
- `resource_type`
- `resource_id`
- `ip`
- `user_agent`
- `created_at`

## Redis Design

Redis stores short-lived auth and security state only. It is not the source of truth for business data.

Keys:

- `refresh_token:{token_id}`: hash of refresh token, user id, expiry metadata.
- `user_sessions:{user_id}`: set of active token ids.
- `login_fail:{username}:{ip}`: login failure counter with TTL.
- `rate_limit:{ip}:{route}`: request counter with TTL.

Auth rules:

- Access token: short-lived JWT, around 15 minutes.
- Refresh token: long random string, around 7 to 30 days.
- Store only refresh token hash in Redis.
- Logout deletes the current token id.
- Password change deletes all token ids for the user.
- User disable deletes all token ids for the user.
- Too many login failures temporarily blocks login attempts.

## API Boundaries

Backend modules:

- `AuthModule`: register, login, refresh, logout, password hashing, Redis token state.
- `UsersModule`: user list, role assignment, status changes.
- `RolesModule`: seeded role list and role lookup.
- `CategoriesModule`: category CRUD and permission filtering.
- `LinksModule`: link CRUD and visible-link queries.
- `PagesModule`: Markdown page CRUD and page rendering payloads.
- `ToolsModule`: tool entry CRUD and visible-tool queries.
- `ServerEntriesModule`: server entry CRUD, with manage permission limited to `admin`.
- `SettingsModule`: site settings.
- `AuditModule`: operation logs.

Frontend calls backend APIs only; it should not read the database directly.

## MVP Scope

MVP includes:

- Open registration with default `练气` role.
- Login, logout, refresh token, and basic login failure protection.
- Admin user management and role assignment.
- Category management.
- Link management.
- Role-aware public and private navigation display.
- Basic Markdown page management.
- Basic tool entry management.
- Server entry display for `admin` and role `管理员`.
- Server entry configuration for `admin` only.
- Operation log for important admin actions.

MVP excludes:

- Email verification.
- Password reset by email.
- Comments.
- Public search.
- User groups.
- Plugin marketplace.
- Complex tool runtime sandboxing.
- Redis-backed business cache.

## Security Notes

- Passwords are stored with a strong hash, not plaintext.
- Refresh tokens are stored as hashes, not plaintext.
- Server entry records do not store passwords, private keys, or proxy secrets.
- Admin routes require backend permission checks, not just frontend hiding.
- Role checks happen on every protected backend endpoint.
- Login failure throttling uses Redis.
- The website should use HTTPS on port `443`.
- 1Panel remains behind its existing extra protection and should not be linked publicly unless the entry is role-gated.

## Deployment Notes

Use Docker Compose for repeatable deployment. Keep `.env` out of git and store generated secrets in the local secret file.

Initial deployment sequence:

1. Start MySQL and Redis.
2. Run Prisma migrations and seed roles.
3. Create the first `admin` user through a one-time bootstrap command.
4. Start backend.
5. Start frontend.
6. Configure Nginx/Caddy for `5200918.xyz` or `www.5200918.xyz`.
7. Verify HTTPS, login, role filtering, and admin routes.

## Open Decisions

- Whether the public site uses root domain `5200918.xyz` or `www.5200918.xyz`.
- Whether to use Nginx or Caddy as reverse proxy.
- Whether the first admin user is created through CLI bootstrap or environment variables.

Default recommendation:

- Use `www.5200918.xyz` for the website if the root domain may remain useful for other services.
- Use Caddy if automatic HTTPS simplicity is preferred.
- Use a one-time backend bootstrap command to create the first `admin`.

