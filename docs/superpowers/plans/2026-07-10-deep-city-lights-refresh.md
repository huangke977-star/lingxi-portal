# HLOVET Deep City Lights Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh HLOVET with a dark city-lights background, centered active navigation, a rounded font stack, and quieter feature modules.

**Architecture:** Only the Web frontend changes. `TopNav` owns route highlighting, mobile menu toggling, and outside-click closing; global CSS owns the darker theme, typography, local background, and responsive layout; the background image is served as a local Next.js static asset.

**Tech Stack:** Next.js App Router, React client components, TypeScript, CSS, local static assets.

## Global Constraints

- The visible brand remains `HLOVET`.
- The font stack uses Option A: `MiSans`, `HarmonyOS Sans SC`, `PingFang SC`, `Microsoft YaHei UI`, and system fallbacks.
- The background uses a local city-lights asset and does not depend on an external background URL.
- Top navigation uses text and a thin active underline, not button backgrounds.
- The portal menu must not expose `/admin`.
- On mobile, the menu toggle sits on a second line under the brand and closes on outside click.

---

### Task 1: Documentation And Local Background Asset

**Files:**
- Create: `docs/superpowers/specs/2026-07-10-deep-city-lights-refresh-design.zh-CN.md`
- Create: `docs/superpowers/specs/2026-07-10-deep-city-lights-refresh-design.md`
- Create: `docs/superpowers/plans/2026-07-10-deep-city-lights-refresh.zh-CN.md`
- Create: `docs/superpowers/plans/2026-07-10-deep-city-lights-refresh.md`
- Create: `apps/web/public/images/hlovet-city-lights.jpg`

**Interfaces:**
- Consumes: the confirmed Option A font stack and city-lights background direction.
- Produces: acceptance criteria and a local background image.

- [ ] Write the Chinese and English design docs.
- [ ] Write the Chinese and English implementation plans.
- [ ] Generate the local city-lights JPG background.

### Task 2: Top Navigation Behavior

**Files:**
- Modify: `apps/web/src/components/top-nav.tsx`

**Interfaces:**
- Consumes: `usePathname`, existing auth helpers, existing `navItems`.
- Produces: active link class names and outside-click closing behavior for the mobile menu.

- [ ] Import `usePathname`.
- [ ] Mark the active navigation item based on the current route.
- [ ] Close the mobile menu when a menu item is selected.
- [ ] Close the mobile menu when the user clicks outside the navigation area.

### Task 3: Dark Glass Visual System

**Files:**
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**
- Consumes: existing page class names.
- Produces: deep glass theme, local background, rounded font stack, centered active nav, text actions, and second-line mobile menu.

- [ ] Replace the font stack with Option A.
- [ ] Change the background URL to `/images/hlovet-city-lights.jpg`.
- [ ] Darken color variables and increase frosted glass strength.
- [ ] Convert the menu to centered text links with active underline.
- [ ] Reduce home actions and login entry toward text-link styling.
- [ ] Adjust card default and hover states.
- [ ] Rework mobile top navigation and menu layout.

### Task 4: Verification, Commit, And Deployment

**Files:**
- No production files.

**Interfaces:**
- Consumes: local lint/build, browser screenshots, GitHub Actions, and production deployment.
- Produces: verified local and online HLOVET UI.

- [ ] Run `pnpm --filter @lingxi/web lint`.
- [ ] Run `pnpm --filter @lingxi/web build`.
- [ ] Run `pnpm build`.
- [ ] Use browser screenshots to inspect desktop, login, mobile home, and mobile menu.
- [ ] Commit and push.
- [ ] Wait for the Docker Images workflow to succeed.
- [ ] Pull images and restart services on the server.
- [ ] Check online pages and API health.
