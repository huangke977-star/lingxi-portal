# HLOVET Six-Phase Product And Engineering Roadmap

- Document status: Active
- Created: 2026-08-04
- Last updated: 2026-08-10
- Current phase: Phase 5 ready to start
- Chinese version: `docs/six-phase-roadmap.zh-CN.md`

## 1. Purpose

This document is the persistent execution record for future HLOVET development. Every new task or conversation should read this roadmap first, continue from the earliest incomplete task ID, and update the status after implementation, testing, and production deployment.

Status definitions:

- `Not started`: Development has not begun.
- `In progress`: Design or implementation has started.
- `Completed`: Code, tests, documentation, deployment, and production verification are complete.
- `Blocked`: External configuration, a product decision, or a third-party service is missing.

## 2. Delivery Principles

1. The six phases form one roadmap but must be developed and deployed independently.
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
| Phase 5 | Social Capability | Group chat, group files, moderation, temporary conversations | Not started |
| Phase 6 | Operations Console | Operational analytics, announcements, scheduling, read statistics | Not started |

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
| P5-01 | Add group, membership, role, and invitation data models | Not started |
| P5-02 | Create groups, invite members, request access, leave groups | Not started |
| P5-03 | Add owner, administrator, and member permission levels | Not started |
| P5-04 | Add group announcements, names, avatars, and personal remarks | Not started |
| P5-05 | Reuse attachment support for group images and files | Not started |
| P5-06 | Add mute, removal, ownership transfer, dissolution, and blocking | Not started |
| P5-07 | Add group-message reporting and administrative navigation | Not started |
| P5-08 | Add temporary conversations, expiry, and cleanup | Not started |
| P5-09 | Complete unread, mute, push, and multi-device synchronization | Not started |
| P5-10 | Complete desktop, mobile, performance, and permission tests | Not started |

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
| P6-01 | Add daily aggregation jobs and aggregate tables | Not started |
| P6-02 | Show user growth, active users, articles, comments, and message trends | Not started |
| P6-03 | Show popular authors, articles, searches, and subscription growth | Not started |
| P6-04 | Show reports, bans, login risks, and failed background jobs | Not started |
| P6-05 | Add public, signed-in, and role-targeted announcements | Not started |
| P6-06 | Add drafts, scheduling, automatic expiry, and pinning | Not started |
| P6-07 | Add read confirmation, views, and unread counts | Not started |
| P6-08 | Deliver announcements through in-app messages and optional push | Not started |
| P6-09 | Apply existing super-admin and administrator permission boundaries | Not started |
| P6-10 | Complete metric definitions, permission tests, and bilingual docs | Not started |

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
| Phase 5 | - | - | - | Not started |
| Phase 6 | - | - | - | Not started |

## 13. Resume Procedure

When continuing this roadmap:

1. Read both roadmap documents.
2. Inspect the current repository, production state, and uncommitted work.
3. Find the earliest `Not started` or `In progress` task in the active phase.
4. Confirm that external prerequisites are available.
5. Implement, test, push, and deploy the task.
6. Update task status, phase overview, and completion log.

Do not infer completion from an old conversation alone. Repository code, database migrations, production verification, and this roadmap are the sources of truth.
