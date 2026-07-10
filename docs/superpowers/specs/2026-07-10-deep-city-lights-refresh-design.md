# HLOVET Deep City Lights Refresh Design

Date: 2026-07-10

## Goal

Refresh HLOVET from the previous Homepage-inspired light glass style into a darker city-lights portal. The background becomes a local night city bitmap, the glass effect becomes stronger, and the top navigation follows the reference screenshot with centered text links and active-page highlighting.

## Confirmed Choices

- Font: Option A, using a rounded system stack such as `MiSans`, `HarmonyOS Sans SC`, `PingFang SC`, and `Microsoft YaHei UI`.
- Background: city lights, loaded as a project-local asset.

## Visual Direction

- Use a dark city-lights background with warm bokeh and a deep blue-green / ink-blue theme.
- Increase frosted blur and translucent depth while keeping text contrast high.
- Center the top menu and use text plus a thin underline for the active page instead of button backgrounds.
- Prefer text links for home actions where possible.
- Remove strong default card elevation; show only subtle border, background, and shadow feedback on hover.

## Mobile Rules

- First row: brand mark and `HLOVET` on the left, login or avatar on the right.
- Second row: menu toggle beneath the brand area on the left.
- Closing behavior: menu links and outside-page clicks close the menu.
- The mobile menu still does not expose `/admin`.

## Scope

This phase includes:

- Adding a local city-lights background asset.
- Updating `TopNav` for active route highlighting and outside-click mobile menu closing.
- Updating global CSS for the darker glass theme, rounded font stack, text actions, and quieter card hover states.
- Preserving existing auth, role badge, avatar menu, and logout behavior.

This phase does not include:

- Backend API changes.
- Real avatar upload.
- Database-backed navigation configuration.
- A public admin entry point.

## Acceptance Criteria

- Home uses a local city-lights background and no longer depends on an external background URL.
- Top navigation is centered and clearly highlights the current route with a thin underline.
- Primary home actions are mostly text links.
- Cards have no strong default elevation and gain only subtle hover feedback.
- The font stack uses confirmed Option A.
- On mobile, the menu toggle sits on a second line below the brand and closes on outside click.
- `pnpm --filter @lingxi/web lint` passes.
- `pnpm --filter @lingxi/web build` passes.
