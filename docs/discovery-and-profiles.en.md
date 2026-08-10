# HLOVET Discovery And Profiles

- Roadmap phase: P4 Discovery And Profiles
- Document date: 2026-08-10
- Current status: The primary P4 release is deployed. This collection/topic interaction refinement is locally complete and awaits user acceptance before commit and deployment.
- Chinese version: `docs/discovery-and-profiles.zh-CN.md`

## 1. Entry Points

| Capability | Entry | Permission |
| --- | --- | --- |
| Subscription feed | Discover -> Subscriptions | Signed-in users |
| My and visible collections | Discover -> Collections | Signed-in users; browse results are viewer-permission filtered |
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
- My Collections uses a searchable multi-select that immediately toggles membership. A dedicated grip reorders selected articles without arrow controls.
- Browse Collections searches collection name, description, owner nickname, and username across every collection visible to the current viewer, with infinite loading.
- Only valid articles owned by the current account may be added.
- Visibility options are public, authenticated, and private.
- Ordering requires the exact current article ID set; missing, duplicate, or foreign IDs are rejected.
- Public collections can be shared at `/collections/:id`; authenticated and private collections remain protected by API authorization.

## 4. Administrator Topics

Topics organize articles across authors and are shared between administrators and super administrators.

- Title, slug, cover URL, local cover upload, description, status, and sort order are supported.
- Local covers accept JPEG, PNG, WebP, and AVIF up to 10 MB. Replacing a managed cover or deleting its topic physically removes the old file.
- Managed topic covers remain in the existing article-media storage, integrity scan, and off-site media-backup category.
- Visibility options are public, authenticated, and role restricted.
- A role-restricted topic must contain at least one valid role.
- Disabled topics are absent from normal topic listings.
- Topic articles use the same searchable multi-select and drag ordering as collections. Membership and ordering persist immediately; the header Save action persists topic metadata.
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
| `GET /discovery/collections`, `GET /discovery/collections/visible` | Search public or viewer-visible collections |
| `GET/POST/PATCH/DELETE /discovery/collections/...` | Owned collection management and ordering |
| `GET /discovery/topics...` | Public or viewer-visible topics |
| `GET/POST/PATCH/DELETE /discovery/admin/topics...` | Administrator topic management |
| `POST /discovery/admin/topics/:id/cover` | Upload and immediately replace a managed topic cover |
| `GET /discovery/topics/covers/:storedName` | Serve a managed topic cover |
| `GET/PATCH /discovery/profile/settings` | Privacy and representative-content settings |
| `GET /discovery/profiles/.../:username` | Showcase content, collections, and visit totals |

## 8. Migration

Migrations: `20260810100000_add_discovery_profiles` and `20260810120000_add_topic_cover_metadata`

They add per-author notification preferences, feed reads, collections, topics, role mappings, ordered article relations, profile settings, representative content, privacy-conscious visit records, and managed topic-cover file metadata.

Both migrations are additive and remove or rename no existing fields. The original P4 migration is deployed; the new topic-cover metadata migration will run with this refinement after local acceptance.

## 9. Verification

- Prisma formatting, validation, and client generation passed.
- All 30 API suites with 198 tests passed.
- API lint, API build, and Web build passed.
- Web lint has no errors and retains 10 pre-existing warnings unrelated to P4.
- Playwright covered full-card mobile topic navigation, collection browsing and selection, topic management, and checkbox states. Existing P4 acceptance covers the feed, profile settings, and public profiles.
- No horizontal overflow was found at 1440px desktop or 390px mobile widths.

Production acceptance must still verify real-account publication delivery, cross-device read state, role-topic visibility, and hidden profile fields after deployment.
