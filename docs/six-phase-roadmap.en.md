# HLOVET Product And Engineering Roadmap

- Document status: Active
- Created: 2026-08-04
- Last updated: 2026-08-19
- Current phase: Phase 10 not started (Phase 9 Privacy And Discovery Extension is complete)
- Chinese version: `docs/six-phase-roadmap.zh-CN.md`

## 1. Purpose

This document is the persistent execution record for future HLOVET development. Every new task or conversation should read this roadmap first, continue from the earliest incomplete task ID, and update the status after implementation, testing, and production deployment.

Status definitions:

- `Not started`: Development has not begun.
- `In progress`: Design or implementation has started.
- `Completed`: Code, tests, documentation, deployment, and production verification are complete.
- `Blocked`: External configuration, a product decision, or a third-party service is missing.

## 2. Delivery Principles

1. All phases form one roadmap but must be developed and deployed independently.
2. Every phase must be independently releasable and recoverable.
3. Database migrations should be additive and backward compatible whenever possible.
4. Incomplete features remain hidden behind permissions or feature flags.
5. Reuse MySQL, Redis, Socket.IO, the current notification system, and existing OSS/R2 configuration.
6. Do not add resource-heavy services such as Elasticsearch, Prometheus, Grafana, or ClickHouse.
7. Background jobs must limit concurrency and disk I/O to protect the VPS.
8. Every new document must have Chinese and English versions.
9. Update this roadmap with task status, commit, deployment time, and production results after every phase.

## 3. Phase Overview

| Phase | Name | Main scope | Status |
| --- | --- | --- | --- |
| Phase 1 | Reliability Foundation | Media backup, missing-file repair, lightweight monitoring | Completed (remote restore drill waived for now) |
| Phase 2 | Account Security | Password recovery, email verification, Turnstile, login-risk alerts | Completed |
| Phase 3 | Content Capability | Autosave, version history, preview, unified search | Completed |
| Phase 4 | Discovery And Profiles | Subscription feed, collections, enhanced profiles | Completed |
| Phase 5 | Social Capability | Group chat, group files, moderation, temporary conversations | Completed |
| Phase 6 | Operations Console | Operational analytics, announcements, scheduling, read statistics | Completed |
| Phase 7 | Backup Recovery Closure | Paired database/media snapshots, integrity verification, restore preflight | Completed |
| Phase 8 | Portal Entry Upgrade | Home, dashboard, and tools-center redesign | Completed |
| Phase 9 | Privacy And Discovery Extension | Social permissions, search scope, discovery entry points | Completed |
| Phase 10 | Moderation Automation | Unified reports, anti-spam, and review rules | In progress (P10-01 awaiting deployment) |

## 4. External Prerequisites

These are required only before their corresponding phase starts:

| Configuration | Phase | Notes |
| --- | --- | --- |
| Cloudflare R2 or Alibaba Cloud OSS credentials | Phase 1 | Both providers remain supported; at least one must be enabled |
| SMTP delivery configuration | Phase 2 | Used for verification, recovery, and login alerts |
| Cloudflare Turnstile site and secret keys | Phase 2 | Used for registration and high-risk operations |
| Group member limit | Phase 5 | Recommended default is 100 members |

## 5. Phase 1: Reliability Foundation

Goal: give database records and physical files a verifiable, backed-up, and recoverable lifecycle while adding lightweight operational visibility.

### Tasks

| ID | Scope | Status |
| --- | --- | --- |
| P1-01 | Add media backup job, backup object, and manifest data models | Completed |
| P1-02 | Cover backgrounds, site assets, APKs, avatars, article images, and chat attachments | Completed |
| P1-03 | Use hashes, sizes, and manifests for incremental backup | Completed |
| P1-04 | Reuse encrypted OSS/R2 configuration with enable, disable, and connection tests | Completed |
| P1-05 | Exclude `.tmp`, `.trash`, and incomplete uploads; default concurrency to one | Completed |
| P1-06 | Add scheduling, retention, retry, and job logs | Completed |
| P1-07 | Restore one file through staging, validation, and atomic replacement | Completed |
| P1-08 | Add remote restore, replacement upload, and confirmed-loss workflows | Completed |
| P1-09 | Add lightweight slow-request, recent-error, memory, and disk trends | Completed |
| P1-10 | Show backup coverage, last success, and issue counts in System Overview | Completed |
| P1-11 | Notify super administrators about backup failures, disk pressure, and missing-file changes | Completed |
| P1-12 | Complete bilingual docs, automated tests, deployment, and a production restore drill | Completed (remote drill waived for now) |

### Current Acceptance Results

- Code, migrations, UI, automated tests, and production deployment are complete for P1-01 through P1-11.
- All 26 API suites with 159 tests, frontend/backend lint and builds, Prisma generation/validation, and production Compose validation passed.
- GitHub Actions runs `30986260663` and hotfix run `30987181919` succeeded. Production recreated only API/Web or API without unrelated MySQL, Redis, Caddy, or TURN restarts.
- Production storage scan `#5` completed with 20 healthy files, 3 historical missing article files, and no orphan files. Desktop and 390px iPhone widths had no horizontal overflow.
- OSS/R2 and remote credentials are not configured, so a real remote upload and production restore drill cannot run yet. On 2026-08-10, the user waived this verification until a remote service is available, so it no longer blocks later phases. The implementation and configuration UI remain available for a future live drill.

### Acceptance

1. All six persistent file categories produce backup manifests.
2. Unchanged files are not uploaded repeatedly.
3. Login, article, and chat APIs remain available during backup.
4. A test file can be restored and verified by hash and size.
5. Missing files can be restored or replaced, and the resolution is recorded.
6. System Overview shows backup time, uncovered files, and job failures.

### Excluded

- Full-server images.
- Docker volume snapshots.
- Arbitrary host-directory backup.
- A new always-running backup service.

## 6. Phase 2: Account Security

Goal: add account recovery, bot protection, and login-risk awareness while keeping registration open.

### Tasks

| ID | Scope | Status |
| --- | --- | --- |
| P2-01 | Add encrypted SMTP administration and connection tests | Completed |
| P2-02 | Add registration email verification and request limits | Completed |
| P2-03 | Add password recovery and revoke all old sessions after reset | Completed |
| P2-04 | Apply Turnstile to registration, repeated login failures, and recovery | Completed |
| P2-05 | Detect new devices, unfamiliar IP addresses, and abnormal login frequency | Completed |
| P2-06 | Deliver login-risk alerts through in-app messages and email | Completed |
| P2-07 | Add account security history to the profile area | Completed |
| P2-08 | Add login, email, and new-device notification preferences | Completed |
| P2-09 | Add administrative views for mail jobs, verification requests, and risk events | Completed |
| P2-10 | Complete throttling, token invalidation, security tests, and bilingual docs | Completed |
| P2-11 | Add untrusted-device email verification, trusted-device management, and per-session sign-out | Completed |

### Current Acceptance Results

- Code, the additive migration, desktop and mobile UI, authorization, automated tests, and bilingual documentation are complete for P2-01 through P2-10.
- All 27 API suites with 173 tests passed. Prisma generation/validation, frontend/backend lint and production builds, and production Compose validation also passed.
- New features default to disabled, historical users remain email-verified after migration, and password recovery revokes every refresh session while immediately invalidating old access tokens through the account security version.
- Commit `a22a04f` was pushed and GitHub Actions run `31064603456` published both API and Web images. Production applied migration 28 on 2026-08-06 and recreated only API/Web; MySQL, Redis, Caddy, and TURN were not restarted.
- Home, login, registration, recovery, Profile, Security Management, and health pages returned `200`. Public policy, unauthenticated `401`, default-disabled state, the server-side credential-encryption environment, and 390px mobile overflow were verified, with no API/Web startup errors.
- SMTP registration verification, password recovery, and Turnstile were manually verified in production. P2-11 untrusted-device email verification remains disabled by default and needs a controlled live acceptance run after preserving a signed-in super-admin session.
- P2-11 commits `8e97c4c` and production fix `c139889` were pushed, and Actions runs `31152045165` and `31152920263` succeeded. Production applied migration 29 on 2026-08-07 and recreated only API/Web. Acceptance caught and rolled back a Socket.IO session-validation crash; after the fix, all 28 API suites with 179 tests passed, repeated API health checks returned `200`, the API restart count stayed at zero, logs were clean, all 14 Redis login sessions remained, and MySQL, Redis, Caddy, and TURN were not restarted. Live acceptance then passed for untrusted-device email verification, trust removal, and per-session sign-out, completing Phase 2.

### Acceptance

1. Users can reset passwords through a verified email address.
2. Password reset invalidates every old refresh session.
3. Automated registration and repeated verification requests are limited.
4. New-device login creates a visible security event and alert.
5. Mail-provider failures do not block ordinary login and remain visible to administrators.

### Excluded

- Mandatory email binding for every existing user.
- SMS verification.
- Third-party social login.

## 7. Phase 3: Content Capability

Goal: reduce editing-loss risk and provide unified search across articles, users, navigation, and tools.

### Tasks

| ID | Scope | Status |
| --- | --- | --- |
| P3-01 | Add debounced editor autosave and visible save state | Completed |
| P3-02 | Keep a local fallback draft when server autosave fails | Completed |
| P3-03 | Add article snapshots, version lists, and version metadata | Completed |
| P3-04 | Restore a historical version by creating a new version | Completed |
| P3-05 | Add pre-publication preview matching the reading page | Completed |
| P3-06 | Add a unified search index and normalized search fields | Completed |
| P3-07 | Search and group articles, users, navigation entries, and tools | Completed |
| P3-08 | Match nicknames, usernames, titles, tags, categories, and pinyin fields | Completed |
| P3-09 | Add search history, trending searches, and history cleanup | Completed |
| P3-10 | Add ranking, permission filtering, pagination, and performance tests | Completed |
| P3-11 | Complete bilingual docs, mobile adaptation, and production verification | Completed |

### Current Acceptance Results

- Autosave, local recovery, immutable snapshots, version restoration, publication preview, and unified search are complete, with bilingual documentation in `docs/content-reliability-and-search.zh-CN.md` and `docs/content-reliability-and-search.en.md`.
- Unified search reuses the existing four result groups and authorization rules while supporting normalized fields, full pinyin and initials, history, trending terms, sorting, pagination, and permission filtering.
- Additive migration `20260807173000_add_content_reliability_and_search` is applied in production, bringing the Prisma migration count to 30. All 83 search-index records were backfilled, with no missing user, article, or portal indexes.
- All 29 API suites with 186 tests, API/Web builds and lint, Prisma validation, and `git diff --check` passed. Web retains only 10 unrelated pre-existing warnings.
- Commit `47c7ae3` was pushed and GitHub Actions run `31165692942` succeeded. Production recreated only API/Web on 2026-08-07 without restarting MySQL, Redis, Caddy, or TURN. Home, search, health, and related external checks returned `200`; desktop and 390px mobile had no horizontal overflow and the browser console had no errors.
- Production acceptance for autosave, draft recovery, version history, publication preview, pinyin search, and permission filtering completed on 2026-08-10, closing Phase 3.

### Acceptance

1. Editing saves drafts without a manual action.
2. Recent content can be recovered after navigation or network failure.
3. Users can inspect and restore historical versions.
4. Search never exposes private articles, server entries, or unauthorized data.
5. Search pagination works on desktop and mobile.

### Excluded

- Elasticsearch or a separate search cluster.
- Simultaneous multi-user article editing.
- Online Office document editing.

## 8. Phase 4: Discovery And Profiles

Goal: turn subscriptions into a useful content feed and improve organization through collections, topics, and richer profiles.

### Tasks

| ID | Scope | Status |
| --- | --- | --- |
| P4-01 | Add a subscription feed and unread counts | Completed |
| P4-02 | Sort by latest, unread, and popularity | Completed |
| P4-03 | Add per-item read, read-all, and author notification settings | Completed |
| P4-04 | Add user-created article collections and ordering | Completed |
| P4-05 | Add administrator topics with cover, description, ordering, and role visibility | Completed |
| P4-06 | Show collections and topics on article cards and reading pages | Completed |
| P4-07 | Let users pin representative articles and collections | Completed |
| P4-08 | Let users control which profile fields are public | Completed |
| P4-09 | Add privacy-conscious profile visit statistics | Completed |
| P4-10 | Complete feed, collection, profile, permission, and mobile tests | Completed |

### Current Acceptance Results

- Local implementation, additive migration, desktop and mobile UI, permission controls, and bilingual documentation are complete for P4-01 through P4-10.
- The subscription feed supports latest, unread, and popularity ordering, item/read-all actions, and per-author notification preferences. Collections support CRUD and article ordering. Administrator topics support status, cover, ordering, and role visibility.
- Article cards and reading pages expose collection and topic metadata only to authorized viewers. Profiles support representative articles, representative collections, and field-level visibility. Visit analytics use SHA-256 digests with daily deduplication and do not store raw IP addresses or User-Agent strings.
- Production has the additive migration `20260810100000_add_discovery_profiles`. All 30 API suites with 194 tests passed, along with API build/lint, Web build/lint, and Prisma validation. Web lint retains only 10 unrelated pre-existing warnings.
- Playwright covered topics, subscription feeds, notification preferences, collections, topic management, profile visibility, and public profile showcases at 1440x900 and 390x844 without horizontal overflow.
- Commit `ad2fd38` was pushed and GitHub Actions run `31351553373` built both API and Web images successfully. On 2026-08-10, production ran `api-bootstrap`, confirmed 31 migrations with none pending, and recreated only API/Web. MySQL, Redis, Caddy, and TURN were not restarted.
- API/Web restart counts remained zero and startup logs contained no errors. The home page, health endpoint, subscription feed, collections, topics, topic management, and public topics API all returned `200`, completing Phase 4.
- A 2026-08-10 follow-up deployed permission-filtered collection discovery, shared immediate multi-select and drag ordering for collections/topics, managed local topic-cover uploads with physical cleanup, and full-card mobile topic navigation. GitHub Actions run `31358640865` succeeded for commit `f3d9010`; production applied migration 32, recreated only API/Web, and passed public-page, health, container-state, and startup-log checks.

### Acceptance

1. New content from subscribed authors appears in the subscription feed.
2. Read state remains consistent across devices.
3. Users can create, order, update, and delete their collections.
4. Administrator topics can target role visibility.
5. Public profiles strictly follow each user's privacy settings.

### Excluded

- Complex machine-learning recommendations.
- Paid content or memberships.
- A fully free-form page builder.

## 9. Phase 5: Social Capability

Goal: extend the current friend, direct-message, attachment, and real-time infrastructure with manageable group chat and temporary conversations.

### Tasks

| ID | Scope | Status |
| --- | --- | --- |
| P5-01 | Add group, membership, role, and invitation data models | Completed |
| P5-02 | Create groups, invite members, request access, leave groups | Completed |
| P5-03 | Add owner, administrator, and member permission levels | Completed |
| P5-04 | Add group announcements, names, avatars, and personal remarks | Completed |
| P5-05 | Reuse attachment support for group images and files | Completed |
| P5-06 | Add mute, removal, ownership transfer, dissolution, and blocking | Completed |
| P5-07 | Add group-message reporting and administrative navigation | Completed |
| P5-08 | Add temporary conversations, expiry, and cleanup | Completed |
| P5-09 | Complete unread, mute, push, and multi-device synchronization | Completed |
| P5-10 | Complete desktop, mobile, performance, and permission tests | Completed |

### Current Acceptance Results

- The additive data model, APIs, desktop and mobile group-chat UI, group-report administration, and production configuration are complete for P5-01 through P5-10. Existing direct-message data remains in `direct` conversations without migration or rebuilding.
- Groups default to 100 members and can be configured through `CHAT_GROUP_MEMBER_LIMIT`. Temporary groups default to seven days, accept a one-to-thirty-day lifetime at creation, and are removed with their attachments and avatars by a controlled hourly cleanup job.
- Group messages reuse the existing Socket.IO connection and attachment storage through conversation rooms, without one connection per group. Per-member unread cursors, mute preferences, browser push, and multi-device read state are persisted independently.
- Owner, administrator, and member permissions cover profile changes, invitations, join requests, aliases, muting, removal, blocking, ownership transfer, leaving, dissolution, report handling, and activity history. Site administrators also receive a dedicated group-report console.
- All 31 API suites with 202 tests passed, together with API/Web builds and lint, Prisma validation, production Compose validation, and `git diff --check`. Web lint retains only ten unrelated pre-existing warnings.
- External Playwright covered group management, group reports, and My Articles at 1440px desktop and 390px mobile widths. Long titles, status labels, metadata, and action rows had no horizontal overflow.
- Production applied additive migration `20260811110000_add_group_social_phase` and updated only API/Web plus the migration container, without restarting MySQL, Redis, Caddy, or TURN. Health, public pages, authorization boundaries, and container logs passed verification.

### Acceptance

1. Members can perform only the operations allowed by their group role.
2. Group messages, images, and files synchronize and download correctly.
3. Mute, removal, leave, dissolution, and report actions produce audit records.
4. Temporary conversations close or clean up according to policy.
5. Group chat does not materially increase idle server memory use.

### Excluded

- Group voice calls.
- Group video calls.
- Large public chat rooms.
- Groups above the configured member limit.

## 10. Phase 6: Operations Console

Goal: give super administrators and administrators actionable operational data and targeted announcement delivery.

### Tasks

| ID | Scope | Status |
| --- | --- | --- |
| P6-01 | Add daily aggregation jobs and aggregate tables | Completed |
| P6-02 | Show user growth, active users, articles, comments, and message trends | Completed |
| P6-03 | Show popular authors, articles, searches, and subscription growth | Completed |
| P6-04 | Show reports, bans, login risks, and failed background jobs | Completed |
| P6-05 | Add public, signed-in, and role-targeted announcements | Completed |
| P6-06 | Add drafts, scheduling, automatic expiry, and pinning | Completed |
| P6-07 | Add read confirmation, views, and unread counts | Completed |
| P6-08 | Deliver announcements through in-app messages and optional push | Completed |
| P6-09 | Apply existing super-admin and administrator permission boundaries | Completed |
| P6-10 | Complete metric definitions, permission tests, and bilingual docs | Completed |

### Current Implementation Results

- The additive `20260812170000_add_operations_console` migration, daily aggregates, ranking snapshots, job records, hourly refresh, and 7/30/90-day rebuild are implemented.
- Thirteen operational metrics, three trend views, author/article/search/subscription-growth rankings, and complete metric definitions are implemented.
- Public, authenticated, and role-targeted announcements support drafts, scheduling, immediate publication, expiry, archiving, pinning, views, read confirmation, and unread counts.
- Announcements use the current in-app system channel with optional browser push. Announcement delivery and daily pending-action reminders use database uniqueness for idempotency.
- Administrators and super administrators share analytics and announcement management while existing super-administrator-only server, security, and backup boundaries remain unchanged.
- All 34 API suites with 216 tests passed. API/Web lint and production builds, Prisma validation, Compose configuration, and diff checks passed. See `docs/operations-console.en.md`.
- Commit `3ddfd18` was pushed and GitHub Actions `31657738785` succeeded. Production applied its 35th migration, `20260812170000_add_operations_console`; aggregate tables contain data and no operation jobs have failed. The API health endpoint and announcements page return `200`, and API, Web, MySQL, Redis, Caddy, and TURN are running normally.
- External Playwright passed the announcements page on desktop and a `390px` mobile viewport, with no horizontal overflow or console errors. Production has no announcement data, so delivery, read confirmation, and quick-action flows were not exercised by generating visible test messages; repeat those manual regressions when a test announcement is available. Repeat the administrator-page visual login review when the current administrator password is available.

### Acceptance

1. Operational pages read aggregate data instead of scanning full business tables per request.
2. Every metric has a documented definition and time range.
3. Announcements target public users, signed-in users, or selected roles.
4. Scheduling, expiry, and read state execute accurately.
5. Administrators cannot access server or security settings reserved for the super administrator.

### Excluded

- Advertising delivery.
- Paid campaigns and ordering.
- A separate data warehouse.

## 11. Definition Of Done For Every Phase

A phase can be marked `Completed` only when all conditions are met:

1. Prisma generation and schema validation pass.
2. API tests, lint, and production build pass.
3. Web lint and production build pass.
4. The production Docker Compose configuration validates.
5. Critical desktop and mobile flows pass Playwright inspection.
6. Permissions, expired-session behavior, and error handling are verified.
7. Chinese and English documentation are updated together.
8. Code is pushed and GitHub Actions images build successfully.
9. Production migration and deployment succeed without unrelated MySQL, Redis, Caddy, or TURN restarts.
10. Production health, logs, memory, and critical workflows are verified.
11. This roadmap's task status and completion record are updated.

## 12. Completion Log

| Phase | Completed | Commit | Deployment | Notes |
| --- | --- | --- | --- | --- |
| Phase 1 | 2026-08-10 | `90e43d3`, `290aa5c`, `fe6c619`, `0569d1a` | P1-01 through P1-11 deployed (2026-08-05) | Remote restore support is complete; the user waived the live OSS/R2 drill until a remote service is available, so it no longer blocks later phases |
| Phase 2 | 2026-08-07 | `a22a04f`, `8e97c4c`, `c139889` | P2-01 through P2-11 deployed (2026-08-07) | Live-device acceptance passed for untrusted-device email verification, trust removal, and per-session sign-out |
| Phase 3 | 2026-08-10 | `47c7ae3` | Deployed 2026-08-07; Actions `31165692942` succeeded | P3-01 through P3-11 passed automated checks and production acceptance |
| Phase 4 | 2026-08-10 | `ad2fd38`, `f3d9010` | Deployed 2026-08-10; Actions `31351553373`, `31358640865` succeeded | P4-01 through P4-10 and the collection/topic interaction refinement passed automated, desktop/mobile, and production health acceptance |
| Phase 5 | 2026-08-12 | `1e7881a`, `ca7294c`, `6eb49bc`, `0c6ac56`, `ebdf73a` | Deployed | P5-01 through P5-10 plus group invitation, moderation, media, and mobile interaction refinements are complete |
| Phase 6 | 2026-08-13 | `3ddfd18` | Deployed; Actions `31657738785` succeeded and production migration applied | P6-01 through P6-10 passed automated checks, migration, health endpoint, and desktop/mobile baseline acceptance; announcement-delivery and administrator-page manual regression will be repeated when a test announcement and current administrator password are available |
| Phase 7 | 2026-08-14 | `c8b0e3e`, `f813700` | Deployed 2026-08-14 with no pending migrations | Paired snapshots, archive verification, restore preflight, and the post-restore attachment scan are complete; 14 focused API tests, API/Web builds, and the production health endpoint passed |
| Phase 8 | 2026-08-14 | `d809d19` | Deployed 2026-08-14 with the portal-preference migration applied | Home, dashboard, tools center, personal shortcuts, administrator recommendations, and mobile restore-dialog centering are complete; focused portal API tests, builds, and desktop/mobile no-overflow checks passed |

## 13. Phase 7 And Beyond Delivery Plan

### Phase 7: Backup Recovery Closure

Goal: prevent local database backups from being separated from uploaded media and make recovery outcomes visible and verifiable.

| ID | Scope | Status |
| --- | --- | --- |
| P7-01 | Create a matching media snapshot for every new SQL backup and additively restore the six upload directories | Completed (`c8b0e3e`, 2026-08-14) |
| P7-02 | Verify SQL, gzip, and media archive readability after backup, then record the latest validation result | Completed (`f813700`; verification metadata is stored beside the backup) |
| P7-03 | Show database size, media size, archive state, and validation state in the backup list | Completed |
| P7-04 | Preflight attachment references and archive availability before restore, including clear legacy SQL-only limitations | Completed (the restore endpoint repeats preflight server-side) |
| P7-05 | Link missing restored attachments to Storage Management repair records and complete desktop/mobile regression | Completed (restore starts an attachment scan and exposes its repair entry) |

Note: restoring a legacy SQL-only backup must retain current media files and cannot claim to recover historical attachments that were already physically deleted.

### Phase 8: Home, Dashboard, And Tools Center

Goal: organize existing articles, messages, groups, announcements, navigation, and management capabilities around the entry points users use every day, without waiting for Phases 9 or 10.

| ID | Scope | Status |
| --- | --- | --- |
| P8-01 | Define information architecture and signed-in/role-aware display rules for home, dashboard, and tools center | Completed |
| P8-02 | Redesign home with announcements, site activity, popular content, topics/collections, and quick entry points | Completed |
| P8-03 | Redesign dashboard with creations, message tasks, group tasks, management tasks, and role-relevant overview | Completed |
| P8-04 | Redesign tools center with search, favorites, ordering, and permission-filtered tool/navigation entries | Completed |
| P8-05 | Persist each user's home shortcuts and tool order while administrators maintain public recommendations | Completed |
| P8-06 | Complete desktop, Android, and iPhone layout verification with no horizontal overflow | Completed |

### Current Implementation Results

- The home page is now a compact information hub. Announcements, popular articles, topics/collections, and shortcuts reuse existing visibility rules. When users have not chosen shortcuts, it falls back to administrator recommendations or visible entries.
- The dashboard brings together article states, unread messages, friend requests, group approvals, comment reports, group reports, and role-relevant management work. Moderator tasks are visible only to administrators and super administrators.
- The tools center searches navigation, tools, and super-administrator server entries together. Signed-in users can save up to thirty entries and drag to reorder them. The API filters deleted, disabled, and unauthorized entries again on both read and write.
- Portal entries now have a homepage recommendation flag and order, maintained in Content Management. Server entries cannot become public recommendations.
- Mobile uses a single-column layout. The database restore dialog is centered against viewport width while preserving its height constraints and avoiding horizontal overflow.
- Prisma schema validation, API build, Web build, API/Web lint, and focused portal API tests passed. The complete API run passed 34 of 35 suites; the sole existing failure is `chat-attachments.e2e-spec.ts`, which calls an outdated download-method signature and is unrelated to P8.

### Phase 9: Privacy And Discovery Extension

Goal: provide controlled social boundaries for real user growth and make public content easier to discover.

| ID | Scope | Status |
| --- | --- | --- |
| P9-01 | Add visibility and delivery settings for profiles, friend requests, private messages, and group invitations | Completed |
| P9-02 | Add a stranger-message request inbox and consistent blacklist behavior | Completed |
| P9-03 | Extend global search to permission-visible topics, collections, groups, and site announcements | Completed |
| P9-04 | Add permission-filtered recommended topics, collections, and active groups to discovery | Completed |

### Current Implementation Results

- Profile settings now cover profile access, friend requests, stranger direct messages, and group invitations. Changes save automatically and are enforced consistently by public profiles, profile popovers, search, friend requests, direct messages, and group invitations.
- Stranger direct messages enter a request inbox by default. Recipients can accept or decline; acceptance creates a standalone conversation and system notifications link directly to it. Blocking in either direction cancels pending requests and prevents later conversations and invitations.
- Global search now covers permission-visible articles, users, navigation entries, tools, topics, collections, groups, and site announcements, with authentication, role, and membership filtering enforced by the API.
- Discovery supports topic and collection subscriptions and recommends visible topics, collections, and active groups that the user has neither joined nor blocked. New articles from subscribed topics and collections enter the subscription feed.
- The configured `pwaIconPath` is now the single source for the browser tab icon, iOS Apple Touch icon, dynamic manifest, shortcuts, push notifications, and service-worker fallback icon. The site-settings update timestamp provides cache invalidation.
- Prisma format/generate/validate, API/Web lint, API/Web builds, 42 focused P9 tests, and the complete API suite of 40 suites and 259 tests passed. All 48 migrations apply in order to a fresh database and seed successfully.
- Playwright acceptance at 390x844 and 1440x900 covered profile settings, global search, discovery, and the main chat window without page-level horizontal overflow. Privacy settings persisted across reloads.
- Commit `7f591ec` was pushed and GitHub Actions `32221090519` built and published the API and Web images. Production applied both additive migrations and recreated only API and Web; the external home page, `/api/health`, and manifest returned `200`, API/Web restart counts stayed at zero, and MySQL, Redis, Caddy, and TURN were not restarted. Two old dangling API/Web images were removed while data volumes remained intact.

### Phase 10: Moderation Automation

Goal: reduce manual review pressure while retaining a complete handling record as public users and groups grow.

| ID | Scope | Status |
| --- | --- | --- |
| P10-01 | Consolidate article-comment, group-message, and user-related reports into one pending queue | In progress (code and local verification complete; awaiting deployment) |
| P10-02 | Add configurable sensitive-word, link-frequency, duplicate-content, and high-frequency-message rules | Not started |
| P10-03 | Add bulk handling, resolution templates, handling deadlines, and automatic notices | Not started |
| P10-04 | Add moderation audit, statistics, and administrator permission-boundary coverage | Not started |

### Current P10-01 Implementation Results

- Added unified report-query and summary endpoints that merge article, comment, and group-message reports into one time-ordered pending queue with source, status, and pagination filters.
- Added an administrator report center, a unified header pending-report popover, a dashboard entry, and an account-menu entry. User feedback remains an independent workflow.
- Resolution and rejection continue to call the existing article, comment, and group-message moderation endpoints, preserving notifications, reputation awards, message deletion, and duplicate-handling protection.
- API/Web lint and production builds passed. Two focused unified-report service tests passed, and the full API suite passed with 41 suites and 270 tests.
- Playwright covered the unified list, header pending queue, filters, and action dialog at 1280px desktop and 390x844 mobile viewports without page-level horizontal overflow. The task will be marked completed after production deployment and health verification.

The fixed delivery order is remaining P7 work -> P8 home/dashboard/tools center -> P9 -> P10. Each phase must be independently accepted, deployed, and recorded under this roadmap's definition of done.

## 14. Resume Procedure

When continuing this roadmap:

1. Read both roadmap documents.
2. Inspect the current repository, production state, and uncommitted work.
3. Find the earliest `Not started` or `In progress` task in the active phase.
4. Confirm that external prerequisites are available.
5. Implement, test, push, and deploy the task.
6. Update task status, phase overview, and completion log.

Do not infer completion from an old conversation alone. Repository code, database migrations, production verification, and this roadmap are the sources of truth.
