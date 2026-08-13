# HLOVET Operations Console And Announcement Management

- Phase: P6 Operations Console
- Document date: 2026-08-13
- Status: deployed with baseline production acceptance complete
- Chinese version: `docs/operations-console.zh-CN.md`

## 1. Entry Points And Permissions

| Feature | Entry | Permission |
| --- | --- | --- |
| Operational analytics | Account menu -> Operations, or `/admin/analytics` | Administrator and super administrator |
| Announcement management | Account menu -> Announcements, or `/admin/announcements` | Administrator and super administrator |
| Site announcements | Account menu -> Site announcements, or `/announcements` | Guests and signed-in users, filtered by audience |

Analytics and announcement management reuse the user-management permission boundary. Administrators can use both operations features, but this does not expose server, security, backup, or other super-administrator-only settings.

## 2. Operational Aggregation

The operations page reads only `daily_operation_metrics` and `daily_operation_rankings`. Page requests never scan all business tables.

- The API refreshes today and yesterday ten seconds after startup, then repeats hourly using China Standard Time calendar days.
- Administrators can rebuild the last 7, 30, or 90 days. Only one aggregation run can execute at a time.
- Every run writes an `operation_job_runs` record with status, start, completion, and error details.
- Daily metrics are uniquely keyed by date and are safe to rebuild. Daily rankings are replaced in one transaction.
- Redis failure does not block aggregation writes or page reads.

### Metric Definitions

| Metric | Definition |
| --- | --- |
| New users | Accounts registered and inserted into the user table that day |
| Active users | Distinct accounts that logged in, read an article, commented, or sent a chat message that day |
| Published articles | Articles first entering the published state that day |
| Comments | Article comments and replies created that day |
| Chat messages | Direct, group, and notification-conversation messages sent that day |
| Article views | Article-view records created that day |
| Likes | Article-like records created that day |
| Favorites | Article-favorite records created that day |
| Subscription growth | Author-subscription relationships created that day |
| Reports | Article-comment and group-message reports created that day |
| Disabled accounts | Accounts updated to disabled that day |
| Login risks | Medium- and high-risk login-security events recorded that day |
| Failed jobs | Failed mail, storage-scan, media-backup, and operations jobs that day |

Popular authors and articles use weighted content output, views, likes, favorites, and comments. Popular searches use cumulative search count. Subscription growth ranks new subscriptions inside the selected range. The page provides 7-, 30-, and 90-day trends plus top-eight rankings.

## 3. Announcement Lifecycle

- `Draft`: visible only in administration and remains editable or deletable.
- `Scheduled`: published by the 30-second lifecycle task after its publish time.
- `Published`: visible to its audience, creates in-app notifications, and may request browser push.
- `Expired`: hidden automatically after its expiry time and no longer editable.
- `Archived`: retained in administration, hidden from users, and can be republished or deleted.

Announcements support pinning and pin order. A scheduled time must be in the future, and expiry must follow publication. Published announcements must be archived before deletion.

## 4. Audience, Reading, And Delivery

| Audience | Visibility |
| --- | --- |
| Public | Guests and signed-in users |
| Authenticated | Any valid signed-in account |
| Role restricted | Signed-in accounts whose current role is selected |

- Lists sort by pinned state, pin order, and publication time.
- Opening an announcement creates or updates the signed-in user's read record.
- Confirming read stores a confirmation timestamp and clears the matching in-app notification unread state.
- Administration shows total views, notification recipients, and confirmed readers.
- Publication uses the existing system notification channel. Disabling browser push does not disable in-app delivery.
- Announcement-user uniqueness prevents lifecycle retries from creating duplicate notifications.

## 5. Pending-Action Reminders

Friend requests, group invitations, join requests, and group-message reports follow these rules:

- An existing unread reminder suppresses duplicates.
- After the reminder is read, an unresolved action produces another reminder after 24 hours.
- A daily-bucket `dedupe_key` unique constraint prevents concurrent duplicate inserts.
- The header badge counts only genuinely unread messages and notifications. Read but unresolved actions do not inflate the badge.
- The header popover retains accept, reject, resolve, and dismiss quick actions.

## 6. Main APIs

| Path | Purpose |
| --- | --- |
| `GET /analytics/admin?range=7|30|90` | Read aggregates, trends, rankings, and definitions |
| `POST /analytics/admin/rebuild` | Rebuild 7, 30, or 90 days |
| `GET /announcements/public` | List announcements visible to guests |
| `GET /announcements/visible` | List announcements visible to the current account |
| `POST /announcements/visible/:id/confirm` | Confirm an announcement as read |
| `GET/POST/PATCH/DELETE /announcements/admin/...` | Manage announcements |
| `POST /announcements/admin/:id/publish` | Publish immediately |
| `POST /announcements/admin/:id/archive` | Archive an announcement |

## 7. Deployment And Verification Boundary

The additive migration is `20260812170000_add_operations_console`. It adds operation aggregates, rankings, job runs, announcements, role targeting, and read records, and extends notifications with announcement and idempotency fields. It does not remove or rebuild existing business data.

This phase was committed as `3ddfd18`; GitHub Actions run `31657738785` succeeded. Production applied `20260812170000_add_operations_console` and now has 35 migrations. Aggregate tables already contain data and there are no failed operation jobs. The API health endpoint and announcements page both return `200`; API, Web, MySQL, Redis, Caddy, and TURN are running, with healthy MySQL and Redis checks.

External Playwright passed the public announcements page on desktop and a `390px` mobile viewport: no horizontal overflow and no console errors. Production currently has no announcement data, so end-to-end announcement delivery, read confirmation, and quick-action verification remain regression checks for when a test announcement is available; this acceptance did not create user-visible test messages. The visual authenticated administrator-page review should also be repeated when the current administrator password is available, without affecting the completed deployment, migration, and API acceptance.
