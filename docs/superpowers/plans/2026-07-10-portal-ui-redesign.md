# Lingxi Portal UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Lingxi Portal from a demo-style UI to a unified modern workspace interface.

**Architecture:** Keep the Next.js App Router and plain global CSS. `layout.tsx` provides the site-wide app shell, page components own their content, and `globals.css` provides the shared design system for layout, entry lists, tables, forms, and modals.

**Tech Stack:** Next.js, React, TypeScript, global CSS, pnpm.

## Global Constraints

- Do not add Tailwind, shadcn/ui, or a large UI dependency.
- Do not change backend APIs, database schema, or deployment configuration.
- Existing admin features must keep working: role updates, enable/disable, and password reset.
- UI copy must be product copy, not design commentary.
- Project documentation stays bilingual in English and Chinese.

---

## Task 1: Unified Layout And Design System

**Files:**
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/globals.css`

**Steps:**
- [ ] Change the root layout into `.app-shell` with `.sidebar` and `.content-shell`.
- [ ] Add brand, primary navigation, and account entry to the sidebar.
- [ ] Rewrite CSS tokens for background, foreground, muted text, borders, surfaces, accent, success, and danger.
- [ ] Add page layout classes: `.page-shell`, `.page-header`, `.content-grid`, `.workspace-grid`.
- [ ] Add shared component styles for buttons, forms, entry items, status badges, realm badges, tables, and modals.

## Task 2: Public Pages And Workspace

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/dashboard/page.tsx`
- Modify: `apps/web/src/app/nav/page.tsx`
- Modify: `apps/web/src/app/tools/page.tsx`

**Steps:**
- [ ] Turn the home page into a portal overview with three core entry points and API status.
- [ ] Update the workspace page to show account identity, role realm, permission hints, and available areas.
- [ ] Add static public entry data to the navigation page.
- [ ] Add static tool entry data to the toolbox page.

## Task 3: Auth Pages And Admin

**Files:**
- Modify: `apps/web/src/app/login/page.tsx`
- Modify: `apps/web/src/app/register/page.tsx`
- Modify: `apps/web/src/app/admin/page.tsx`

**Steps:**
- [ ] Move login and register pages into the new `.auth-panel` form surface.
- [ ] Update admin heading, summary, table, and row actions to the new workspace visual system.
- [ ] Preserve the password reset modal logic and do not add a delete button.

## Task 4: Verification, Commit, Deploy

**Files:**
- Verify all frontend changes.

**Steps:**
- [ ] Run `pnpm --filter @lingxi/web lint`.
- [ ] Run `pnpm --filter @lingxi/web build`.
- [ ] Run `pnpm build`.
- [ ] Commit and push.
- [ ] Wait for GitHub Actions image build success.
- [ ] Deploy by pulling images and running compose on the server; do not build on the server.
- [ ] Verify `https://5200918.xyz/` and `https://5200918.xyz/admin` are reachable.

## Self-Review Notes

- This plan only covers visual and layout redesign.
- Data CRUD, icon library adoption, dark mode, and shadcn migration remain future work.
- Documentation contains no real credentials.
