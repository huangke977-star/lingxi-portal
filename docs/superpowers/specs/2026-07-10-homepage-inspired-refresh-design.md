# HLOVET Homepage-Inspired Refresh Design

Date: 2026-07-10

## Goal

Refresh HLOVET toward the visual organization of `gethomepage.dev`: a wider, lighter personal portal with an unframed top navigation, frosted content surfaces, and a real image behind the glass background.

## Visual Direction

Theme: image-backed glass, light overlay, low shadows, wide content, and restrained entry modules.

Content plan:

- Place the brand, menu, and account controls in the normal top area instead of inside a floating frame.
- Expand the main content width so the desktop layout no longer feels squeezed.
- Use a photographic background with a soft overlay, then rely on translucent panels and blur for the glass effect.
- Keep home, navigation, toolbox, and dashboard modules calm on hover: background and border changes only, without visible protrusion.
- Make login, registration, and password dialogs simple centered panels with a blurred backdrop and no extra marketing copy.
- Keep `/admin` available only by direct URL and out of the public portal menu.

## Mobile Rules

- Home remains the default view.
- The top left shows the menu icon and HLOVET brand mark.
- The top right shows the login action or user avatar.
- Non-home menu items are hidden by default and revealed from the left menu icon.
- Selecting a menu item closes the mobile menu.

## Scope

This phase includes:

- Updating `TopNav` with a mobile menu toggle and unframed top navigation styling.
- Updating login and registration pages to remove side copy and use simple modal-like forms.
- Updating global CSS for the image background, wider layout, lighter module hover states, and unified modal backdrop.
- Preserving the existing auth, role badge, avatar menu, and logout behavior.

This phase does not include:

- Backend API changes.
- Real avatar upload.
- Database-backed navigation configuration.
- A new admin entry point.

## Acceptance Criteria

- The top brand and menu are not inside a floating glass frame.
- Desktop content is visibly wider than the previous version.
- A background image is visible behind the frosted surfaces.
- Login and registration pages have no extra side information and use centered blurred panels.
- Functional modules do not jump upward or protrude on hover.
- Mobile hides the menu by default, opens it from the left icon, and keeps the account entry on the right.
- `pnpm --filter @lingxi/web lint` passes.
- `pnpm --filter @lingxi/web build` passes.
