# HLOVET Glass Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the site to the HLOVET brand and a light frosted card portal with a top-right login/avatar/level-badge interaction.

**Architecture:** Keep the Next.js App Router. `layout.tsx` imports a new client-side `TopNav` component; `TopNav` reads tokens from localStorage and calls `/auth/me` for user state. Pages keep using global CSS and no new UI dependency is introduced.

**Tech Stack:** Next.js, React, TypeScript, global CSS, pnpm.

## Global Constraints

- Visible site brand is consistently `HLOVET`.
- Do not expose the admin entry in portal navigation, home page, or ordinary workspace entry lists.
- Direct `/admin` access remains available.
- Logged-in users see a level badge and avatar in the top-right area.
- Hovering the level badge shows the concrete user level.
- Hovering the avatar shows an account action menu.
- Do not change backend APIs, database schema, or deployment configuration.
- Project documentation stays bilingual in English and Chinese.

---

## Task 1: Top Navigation And Account Menu

**Files:**
- Create: `apps/web/src/components/top-nav.tsx`
- Modify: `apps/web/src/app/layout.tsx`

**Steps:**
- [ ] Create the `TopNav` client component.
- [ ] When logged out, show `HLOVET`, navigation, tools, workspace, and a right-side login entry.
- [ ] When logged in, call `/auth/me` and show the level badge plus avatar.
- [ ] On avatar hover, show workspace, navigation, toolbox, and logout.
- [ ] Remove admin from top navigation.
- [ ] Use `TopNav` in `layout.tsx`.

## Task 2: Glass Card Visual System

**Files:**
- Modify: `apps/web/src/app/globals.css`

**Steps:**
- [ ] Change global layout to top navigation plus main content.
- [ ] Add a light frosted background, translucent cards, soft shadows, and hover lift.
- [ ] Add styles for account menu, level badge, avatar, card grids, and portal hero.
- [ ] Preserve usable styles for admin tables, forms, and modals.

## Task 3: Brand And Page Content Updates

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/dashboard/page.tsx`
- Modify: `apps/web/src/app/nav/page.tsx`
- Modify: `apps/web/src/app/tools/page.tsx`
- Modify: `apps/web/src/app/login/page.tsx`
- Modify: `apps/web/src/app/register/page.tsx`
- Modify: `apps/web/src/app/admin/page.tsx`

**Steps:**
- [ ] Replace visible “灵犀门户 / Lingxi Portal” copy with `HLOVET`.
- [ ] Use card-based entries on the home page and do not show admin.
- [ ] Remove admin from the workspace entry list.
- [ ] Use card grids on navigation and toolbox pages.
- [ ] Use centered frosted cards for login and register.
- [ ] Keep admin features available without adding an admin portal link.

## Task 4: Verification, Commit, Deploy

**Files:**
- Verify all frontend changes.

**Steps:**
- [ ] Run `pnpm --filter @lingxi/web lint`.
- [ ] Run `pnpm --filter @lingxi/web build`.
- [ ] Run `pnpm build`.
- [ ] Use the Edge channel to screenshot-check home, mobile home, login, and admin.
- [ ] Commit and push.
- [ ] Wait for GitHub Actions image build success.
- [ ] Deploy by pulling images and running compose on the server; do not build on the server.
- [ ] Verify `https://5200918.xyz/`, `/login`, and `/admin` are reachable.

## Self-Review Notes

- This plan only changes frontend brand, layout, and interaction.
- Admin security remains enforced by backend guards, not by hidden links.
- Documentation contains no real credentials.
