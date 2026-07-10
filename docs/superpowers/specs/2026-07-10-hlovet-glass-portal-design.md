# HLOVET Glass Portal Design

Date: 2026-07-10

## Goal

Rename the visible product brand to `HLOVET`, replace the previous sidebar workspace style with a light card-based glass portal experience, and remove the admin entry from the public portal.

## Visual Direction

Visual thesis: light, airy, glass-like, softly shadowed, and card-forward; the product should feel like a personal portal and tool entry surface rather than an enterprise workspace.

Content plan:

- Top navigation shows `HLOVET`, navigation, tools, workspace, and the account area on the right.
- When logged out, the top-right area shows a login entry.
- When logged in, the top-right area shows a level badge and user avatar.
- Hovering the level badge reveals the concrete user role and level.
- Hovering the avatar reveals an account action menu.
- Home, navigation, and toolbox pages use card grids and translucent frosted panels.
- Portal navigation and home page do not expose the admin entry.
- `/admin` remains available as a direct URL and stays protected by super-admin authorization.

## Scope

This phase includes:

- Replace visible “灵犀门户 / Lingxi Portal” copy with `HLOVET`.
- Add a client-side top navigation component that reads auth state and displays avatar, level badge, and account menu.
- Change the global layout from sidebar workspace to top navigation plus glass portal background.
- Update home, navigation, toolbox, login, register, and workspace screens to a light frosted card style.
- Remove the admin entry from public portal navigation and normal entry lists.
- Keep the admin page available as a direct page.

This phase does not include:

- Real avatar upload.
- Admin entry permission configuration.
- Dark mode.
- Database-backed navigation/tool CRUD.
- Authentication, role, or admin API changes.

## Interaction Rules

- Cards lift slightly on hover, with stronger borders and shadows.
- Top navigation uses a translucent frosted background.
- The level badge uses `title` plus a custom tooltip to show role name and level.
- The avatar menu includes workspace, navigation, toolbox, and logout actions.
- Super admins can still manually visit `/admin`, but the ordinary portal UI does not link to it.

## Acceptance Criteria

- Visible site brand is consistently `HLOVET`.
- The top-right area shows “登录” when logged out.
- Logged-in users see a level badge and avatar.
- Hovering the avatar reveals account actions.
- Portal navigation and home page do not show an admin entry.
- Direct access to `/admin` still reaches the authorization flow and user management.
- `pnpm --filter @lingxi/web lint` passes.
- `pnpm --filter @lingxi/web build` passes.
- `pnpm build` passes.
