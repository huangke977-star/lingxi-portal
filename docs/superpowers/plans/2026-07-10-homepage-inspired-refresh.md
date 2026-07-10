# HLOVET Homepage-Inspired Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh HLOVET into a wider Homepage-inspired portal with image-backed glass, restrained modules, and mobile menu behavior.

**Architecture:** Only the Web frontend changes. `TopNav` owns account state, desktop navigation, and mobile menu behavior; page components keep existing route and auth flows; `globals.css` owns the visual system, background, dialogs, and responsive layout.

**Tech Stack:** Next.js App Router, React client components, TypeScript, CSS, existing auth API helpers.

## Global Constraints

- The visible brand is `HLOVET`.
- The portal menu must not expose `/admin`.
- Logged-in users still see the role badge and avatar menu.
- The top brand and menu must not sit inside a floating frame.
- Login, registration, and dialogs use simple centered panels with blurred backdrops.
- Mobile hides the menu by default and opens it from a left-side icon.

---

### Task 1: Documentation

**Files:**
- Create: `docs/superpowers/specs/2026-07-10-homepage-inspired-refresh-design.zh-CN.md`
- Create: `docs/superpowers/specs/2026-07-10-homepage-inspired-refresh-design.md`
- Create: `docs/superpowers/plans/2026-07-10-homepage-inspired-refresh.zh-CN.md`
- Create: `docs/superpowers/plans/2026-07-10-homepage-inspired-refresh.md`

**Interfaces:**
- Consumes: the user's six visual and mobile requirements.
- Produces: acceptance criteria for this frontend refresh.

- [ ] Write the Chinese and English design docs.
- [ ] Write the Chinese and English implementation plans.
- [ ] Confirm the docs contain no unfinished placeholders or contradictory scope.

### Task 2: Top Navigation And Mobile Menu

**Files:**
- Modify: `apps/web/src/components/top-nav.tsx`

**Interfaces:**
- Consumes: `getMe`, `logout`, `readAccessToken`, `readRefreshToken`, `clearAuthTokens`.
- Produces: style hooks such as `.menu-toggle`, `.desktop-links`, `.mobile-menu`, and `.mobile-menu.open`.

- [ ] Add `isMenuOpen` state.
- [ ] Keep Home, Navigation, Tools, and Dashboard links on desktop.
- [ ] On mobile, show the menu button and brand on the left and login/avatar on the right.
- [ ] Close the mobile menu when a menu link is clicked.
- [ ] Do not add an `/admin` link.

### Task 3: Simplified Login And Registration

**Files:**
- Modify: `apps/web/src/app/login/page.tsx`
- Modify: `apps/web/src/app/register/page.tsx`

**Interfaces:**
- Consumes: existing `login`, `register`, and `saveAuthTokens` helpers.
- Produces: simplified `.auth-page`, `.auth-panel`, and `.auth-panel-head` structure.

- [ ] Remove side copy blocks.
- [ ] Preserve required forms, errors, and login/register cross-links.
- [ ] Keep login success redirecting to `/dashboard`.
- [ ] Keep registration success redirecting to `/dashboard`.

### Task 4: Global Visual System

**Files:**
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**
- Consumes: existing class names used by portal pages.
- Produces: image-backed page styling, wider content, unframed navigation, restrained hover states, modal-style auth, and mobile menu rules.

- [ ] Change `body` to use a real image plus soft overlay.
- [ ] Increase `content-shell` and `topbar-inner` max widths for desktop.
- [ ] Remove the top navigation frame treatment.
- [ ] Reduce entry module hover transform and shadow intensity.
- [ ] Unify blurred backdrop behavior for auth pages and admin password dialogs.
- [ ] Add mobile menu open/closed layout rules.

### Task 5: Verification

**Files:**
- No production files.

**Interfaces:**
- Consumes: local Next.js build and lint scripts.
- Produces: passing verification output and browser screenshots.

- [ ] Run `pnpm --filter @lingxi/web lint`.
- [ ] Run `pnpm --filter @lingxi/web build`.
- [ ] Run `pnpm build`.
- [ ] Use browser screenshots to check `/`, `/login`, and mobile `/`.
- [ ] Search web source for old brand text.
- [ ] Search for accidental public `/admin` links.
