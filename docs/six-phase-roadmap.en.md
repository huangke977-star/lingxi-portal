# HLOVET Six-Phase Product And Engineering Roadmap

- Document status: Active
- Created: 2026-08-04
- Last updated: 2026-08-04
- Current phase: Phase 1 not started
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
| Phase 1 | Reliability Foundation | Media backup, missing-file repair, lightweight monitoring | In progress |
| Phase 2 | Account Security | Password recovery, email verification, Turnstile, login-risk alerts | Not started |
| Phase 3 | Content Capability | Autosave, version history, preview, unified search | Not started |
| Phase 4 | Discovery And Profiles | Subscription feed, collections, enhanced profiles | Not started |
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
| P1-02 | Cover backgrounds, site assets, APKs, avatars, article images, and chat attachments | Not started |
| P1-03 | Use hashes, sizes, and manifests for incremental backup | Not started |
| P1-04 | Reuse encrypted OSS/R2 configuration with enable, disable, and connection tests | Not started |
| P1-05 | Exclude `.tmp`, `.trash`, and incomplete uploads; default concurrency to one | Not started |
| P1-06 | Add scheduling, retention, retry, and job logs | Not started |
| P1-07 | Restore one file through staging, validation, and atomic replacement | Not started |
| P1-08 | Add remote restore, replacement upload, and confirmed-loss workflows | Not started |
| P1-09 | Add lightweight slow-request, recent-error, memory, and disk trends | Not started |
| P1-10 | Show backup coverage, last success, and issue counts in System Overview | Not started |
| P1-11 | Notify super administrators about backup failures, disk pressure, and missing-file changes | Not started |
| P1-12 | Complete bilingual docs, automated tests, deployment, and a production restore drill | Not started |

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
| P2-01 | Add encrypted SMTP administration and connection tests | Not started |
| P2-02 | Add registration email verification and request limits | Not started |
| P2-03 | Add password recovery and revoke all old sessions after reset | Not started |
| P2-04 | Apply Turnstile to registration, repeated login failures, and recovery | Not started |
| P2-05 | Detect new devices, unfamiliar IP addresses, and abnormal login frequency | Not started |
| P2-06 | Deliver login-risk alerts through in-app messages and email | Not started |
| P2-07 | Add account security history to the profile area | Not started |
| P2-08 | Add login, email, and new-device notification preferences | Not started |
| P2-09 | Add administrative views for mail jobs, verification requests, and risk events | Not started |
| P2-10 | Complete throttling, token invalidation, security tests, and bilingual docs | Not started |

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
| P3-01 | Add debounced editor autosave and visible save state | Not started |
| P3-02 | Keep a local fallback draft when server autosave fails | Not started |
| P3-03 | Add article snapshots, version lists, and version metadata | Not started |
| P3-04 | Restore a historical version by creating a new version | Not started |
| P3-05 | Add pre-publication preview matching the reading page | Not started |
| P3-06 | Add a unified search index and normalized search fields | Not started |
| P3-07 | Search and group articles, users, navigation entries, and tools | Not started |
| P3-08 | Match nicknames, usernames, titles, tags, categories, and pinyin fields | Not started |
| P3-09 | Add search history, trending searches, and history cleanup | Not started |
| P3-10 | Add ranking, permission filtering, pagination, and performance tests | Not started |
| P3-11 | Complete bilingual docs, mobile adaptation, and production verification | Not started |

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
| P4-01 | Add a subscription feed and unread counts | Not started |
| P4-02 | Sort by latest, unread, and popularity | Not started |
| P4-03 | Add per-item read, read-all, and author notification settings | Not started |
| P4-04 | Add user-created article collections and ordering | Not started |
| P4-05 | Add administrator topics with cover, description, ordering, and role visibility | Not started |
| P4-06 | Show collections and topics on article cards and reading pages | Not started |
| P4-07 | Let users pin representative articles and collections | Not started |
| P4-08 | Let users control which profile fields are public | Not started |
| P4-09 | Add privacy-conscious profile visit statistics | Not started |
| P4-10 | Complete feed, collection, profile, permission, and mobile tests | Not started |

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
| Phase 1 | - | - | - | In progress; P1-01 models and migration completed |
| Phase 2 | - | - | - | Not started |
| Phase 3 | - | - | - | Not started |
| Phase 4 | - | - | - | Not started |
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
