# HLOVET Discovery And Profiles

- Roadmap phase: P4 Discovery And Profiles
- Document date: 2026-08-10
- Current status: Local implementation and automated verification complete; commit, deployment, and production acceptance remain pending
- Chinese version: `docs/discovery-and-profiles.zh-CN.md`

## 1. Entry Points

| Capability | Entry | Permission |
| --- | --- | --- |
| Subscription feed | Discover -> Subscriptions | Signed-in users |
| My collections | Discover -> Collections | Signed-in users |
| Topic catalog | Discover -> Topics | Guests and signed-in users, filtered by permission |
| Topic management | Topics -> Manage topics, or `/admin/topics` | Administrators and super administrators |
| Profile presentation | Profile -> Profile presentation | Current account |
| Public profile | User avatar, nickname, or `/users/:username` | Guests and signed-in users |

## 2. Subscription Feed

The feed is derived from the existing author-subscription relationship. It does not duplicate article bodies or introduce a recommendation service.

- `Latest` sorts by publication time and article ID descending.
- `Unread` keeps unread articles before read articles while preserving publication order in each group.
- `Popular` sorts by comments, favorites, likes, views, and publication time.
- Per-item reads are stored in `subscription_feed_reads`, so read state is shared across browsers and devices.
- Read-all uses a deduplicated bulk insert.
- Per-author notification settings affect only new-article notifications. The subscription and feed remain active.
- Publication notifications target only subscriptions with `notify_new_articles` enabled.

## 3. Article Collections

Users may manage only their own collections. Deleting a collection never deletes its articles.

- Create, update, delete, add or remove articles, and order articles within a collection.
- Only valid articles owned by the current account may be added.
- Visibility options are public, authenticated, and private.
- Ordering requires the exact current article ID set; missing, duplicate, or foreign IDs are rejected.
- Public collections can be shared at `/collections/:id`; authenticated and private collections remain protected by API authorization.

## 4. Administrator Topics

Topics organize articles across authors and are shared between administrators and super administrators.

- Title, slug, cover path or URL, description, status, and sort order are supported.
- Visibility options are public, authenticated, and role restricted.
- A role-restricted topic must contain at least one valid role.
- Disabled topics are absent from normal topic listings.
- Articles can be added, removed, and ordered with an exact-set operation.
- Deleting a topic never deletes its articles.

General article cards and reading pages return only collection and topic labels that the viewer may open. Guests receive public labels only; signed-in users may receive authenticated labels; role topics are role filtered; private collections are visible only to their owner and super administrators.

## 5. Public Profiles

Users can control whether the following fields are public:

- Bio.
- Join date.
- Content and visit statistics.
- Following count.
- Representative content.

Representative content can contain one published article and one collection owned by the user. When representative content is disabled, the public API and page omit it.

Public profiles can show representative content, visible collections, public article counts, received likes, public views, subscribers, following, and profile visits. Owners still see their full profile so they can verify their settings; all other viewers receive strictly filtered fields.

## 6. Visit Privacy

Profile visits are deduplicated by visitor and calendar date.

- Signed-in visitors are hashed from the user ID with SHA-256.
- Anonymous visitors are hashed from IP and User-Agent with SHA-256.
- Only the 64-character hash and date are stored. Raw IP addresses and User-Agent values are never persisted.
- When statistics are private, the API returns no visit count and skips the other hidden-statistic queries.
- Self visits are not counted.

This is lightweight profile traffic measurement, not device fingerprinting or cross-site tracking.

## 7. Main API Surface

| Path | Purpose |
| --- | --- |
| `GET /discovery/feed` | Feed, unread count, and sorting |
| `POST /discovery/feed/:articleId/read` | Mark one item read |
| `POST /discovery/feed/read-all` | Mark all items read |
| `GET/PATCH /discovery/subscriptions/...` | Per-author notification settings |
| `GET/POST/PATCH/DELETE /discovery/collections/...` | Collection management and ordering |
| `GET /discovery/topics...` | Public or viewer-visible topics |
| `GET/POST/PATCH/DELETE /discovery/admin/topics...` | Administrator topic management |
| `GET/PATCH /discovery/profile/settings` | Privacy and representative-content settings |
| `GET /discovery/profiles/.../:username` | Showcase content, collections, and visit totals |

## 8. Migration

Migration: `20260810100000_add_discovery_profiles`

It adds per-author notification preferences, feed reads, collections, topics, role mappings, ordered article relations, profile settings, representative content, and privacy-conscious visit records.

The migration is additive and does not remove or rename existing fields. It was applied to the server database through an SSH tunnel with `prisma migrate deploy` on 2026-08-10. API and Web images still need deployment after the code is committed.

## 9. Verification

- Prisma formatting, validation, and client generation passed.
- All 30 API suites with 194 tests passed.
- API lint, API build, and Web build passed.
- Web lint has no errors and retains 10 pre-existing warnings unrelated to P4.
- Playwright covered topics, the feed, author preferences, collections, topic management, profile settings, and public profiles.
- No horizontal overflow was found at 1440px desktop or 390px mobile widths.

Production acceptance must still verify real-account publication delivery, cross-device read state, role-topic visibility, and hidden profile fields after deployment.
