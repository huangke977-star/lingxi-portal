# Redis Cache Management Design

## Goal

Provide HLOVET super administrators with an integrated Redis management page for runtime metrics, cursor-based key browsing, redacted value inspection, and business-consistent safe operations without exposing Redis publicly or adding an arbitrary command console.

## Authorization

- Menu entry: `Cache Management` in the avatar menu.
- Page route: `/admin/cache`.
- API route: `/api/admin/cache/*`.
- Both frontend and backend require `isSuperAdmin=true`.
- The administrator role is denied even at role level 90.

## Features

- Redis version, uptime, clients, key count, memory, hit rate, expiration, and eviction metrics.
- Cursor-based `SCAN` queries by key search, business category, and Redis type, defaulting to 10 keys per page and limited to 100.
- String, Set, Hash, List, ZSet, and Stream inspection, limited to 200 collection entries or 64 KB strings.
- JSON formatting with recursive redaction for passwords, tokens, secrets, cookies, and authorization fields.
- `tokenHash` shows only a short prefix and suffix; raw refresh tokens never reach the page.
- Safe bulk handling for up to 20 selected keys.
- Deleting `refresh_token:*` also removes its `user_sessions:*` index entry.
- Deleting `user_sessions:*` revokes every refresh session belonging to that user.
- Deleting `login_fail:*` clears the matching login failure counter.
- Business cache TTL values can be updated individually or in bulk; authentication cache TTL values cannot.
- Selected keys expose separate bulk TTL and delete/clear actions, with the number of TTL-eligible business keys stated explicitly.

## Interaction Feedback

- Cache management, login, registration, profile, user management, and background management use one bottom-right toast pattern.
- Toasts render through a portal and remain outside page layout, so they do not alter page height or scrollbars.
- Success, error, and in-progress states share dimensions and use distinct semantic colors.

## Safety Limits

- No `KEYS *`, `FLUSHDB`, `FLUSHALL`, or arbitrary Redis command execution.
- Redis remains on the internal Docker network with no public `6379` port.
- Values are loaded on demand instead of through full-database polling.
- Overview metrics refresh every 30 seconds; keys reload only after filters, cursor navigation, or manual refresh.
- Deletion and session revocation require frontend confirmation.

## Verification

- Regular users and administrators receive 403 responses.
- Super administrators can read metrics, keys, and redacted details.
- Sensitive raw values never appear in responses.
- Session deletion keeps token keys and user session indexes consistent.
- Authentication TTL updates return 400 while individual and bulk business cache TTL updates succeed.
- API tests, frontend/backend lint, and production builds pass.
