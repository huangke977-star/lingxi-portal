# Session Renewal And Management Design

## Goal

Keep users signed in during normal activity, distinguish authentication expiry from authorization denial, cap accumulated login sessions, and give users direct control over their active devices.

## Token Lifecycle

- Access tokens remain short lived and include a `sid` claim identifying the current refresh session.
- The browser renews about two minutes before Access Token expiry.
- A protected request that receives `401` performs one refresh and retries once.
- Concurrent refreshes use an in-tab promise plus a short localStorage lock across tabs.
- A normal `403` response is shown as an authorization error and does not clear tokens.
- Refresh responses with `401` or `403` clear local authentication because the refresh session is invalid or the account is disabled.
- Refresh Token rotation keeps the original session login time while extending its expiry.
- Login, refresh, and session-list requests record the latest available device user agent and proxy-forwarded client IP, allowing older sessions with missing metadata to be repaired when the profile is opened.

## Session State

- Refresh records are stored as `refresh_token:{tokenId}`.
- Account indexes are stored as `user_sessions:{userId}` and receive the same policy TTL.
- Missing token records are removed from session indexes during cleanup.
- Each account keeps at most `MAX_REFRESH_SESSIONS_PER_USER` active sessions, defaulting to 10 and capped at 100.
- When the limit is exceeded, the current session and newest remaining sessions are kept.

## User Controls

- `POST /auth/sessions` lists active sessions and marks the current session.
- `POST /auth/sessions/revoke-others` revokes every Refresh Token except the current one.
- `POST /auth/sessions/revoke-all` revokes every Refresh Token for the account.
- `/profile` shows device/browser, IP, login time, expiry time, and current-device status.
- The account summary shows the current device and IP. The full session panel is collapsed by default and opens from the device icon, whose accent state reflects whether the panel is expanded.
- Revoking all sessions clears local tokens and returns the current browser to the homepage.

## Cache TTL Policy

Authentication cache TTLs are system-managed and cannot be changed from Redis cache management. Manual changes could make refresh records and user-session indexes disagree. Business cache TTLs remain editable.

Revoking a Refresh Token prevents future renewal. An Access Token already issued for that session remains valid only until its own short expiration.

## Verification

- Access JWTs contain `sid`.
- Refresh rotation invalidates the old token and preserves the original login time.
- Session listing identifies the current session.
- Revoke-other and revoke-all operations keep Redis records and indexes consistent.
- Stale index members are removed and the 10-session default is enforced.
- API tests, API/web lint, and API/web production builds pass.
