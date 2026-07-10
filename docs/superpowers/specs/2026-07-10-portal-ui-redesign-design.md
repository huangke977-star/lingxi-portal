# Lingxi Portal UI Redesign Design

Date: 2026-07-10

## Goal

Redesign the current demo-like large-heading pages into a modern workspace interface so the public entry, logged-in workspace, navigation, toolbox, and admin screens feel like one durable portal system.

## Visual Direction

Visual thesis: calm, crisp, developer-oriented workspace UI with a light neutral background, fine borders, clear hierarchy, and restrained blue/teal state accents.

Content plan:

- Use one app shell across the site: sidebar navigation, right-side workspace, and a compact top navigation on mobile.
- Turn the home page into a portal overview with account entry, navigation entry, toolbox entry, and API status.
- Show identity, role realm, and available next areas on the workspace page.
- Use entry lists for navigation and toolbox pages instead of empty states.
- Keep the admin page table-first, denser, and easier to scan.

Interaction thesis:

- Navigation and entry rows use subtle movement, border, and background transitions.
- Status and role badges use stable colors without ornamental animation.
- Modals and tables keep their current behavior while improving visual hierarchy.

## Scope

This phase includes:

- Refactor `RootLayout` into a unified workspace shell.
- Rewrite global CSS tokens, layout, buttons, forms, tables, modals, and entry-list styles.
- Update the home, dashboard, navigation, toolbox, login, register, and admin page structures and copy.
- Preserve the current backend API, authentication logic, and admin features.
- Use static navigation/tool sample data to make the layout real before database-backed CRUD exists.

This phase does not include:

- Adding Tailwind, shadcn/ui, or a large UI dependency.
- Adding database tables.
- Adding navigation/tool CRUD.
- Adding an icon library.
- Dark mode.

## Design Rules

- Main app screens are not marketing heroes.
- Page headings use workspace scale, not oversized display type.
- Cards are used only for entry items, status blocks, forms, and modals; no nested cards.
- Role realms are a light identity layer through badges and copy, not a historical fantasy skin.
- Mobile layouts must avoid text overflow, and the sidebar must become a horizontally scannable top navigation.
- Keep deployment simple: only frontend pages and CSS change, with no API container configuration impact.

## Acceptance Criteria

- Home, workspace, navigation, toolbox, login, register, and admin screens share one visual system.
- Public and admin pages remain readable on mobile.
- Existing admin features remain intact: role updates, enable/disable, and password reset.
- Pages no longer show large empty first-pass surfaces.
- `pnpm --filter @lingxi/web lint` passes.
- `pnpm --filter @lingxi/web build` passes.
- `pnpm build` passes.
