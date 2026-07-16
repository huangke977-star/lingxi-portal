# HLOVET Portal Content Management Design

## Goal

Move navigation links, tools, and server entries from frontend constants into MySQL so administrators can maintain ordinary portal content while the backend enforces authentication and role visibility.

## Permission Rules

- `PUBLIC`: visible to guests and every signed-in user.
- `AUTHENTICATED`: visible to every signed-in user.
- `ROLE_RESTRICTED`: visible only to assigned roles; the super administrator always bypasses this restriction.
- `SERVER` categories are a hard exception: only accounts with `isSuperAdmin=true` may read or manage them. The administrator role cannot read them and cannot bypass this rule by changing visibility settings.
- Administrators and the super administrator may manage `NAVIGATION`, `TOOL`, and `CUSTOM_PAGE` categories.
- Server categories are omitted from administrator responses, and direct administrator requests to server management endpoints return `403`.

## Data Model

- `PortalCategory`: kind, name, description, ordering, and status.
- `PortalEntry`: title, description, URL, icon, opening behavior, visibility, ordering, and status.
- `PortalEntryRole`: many-to-many role assignments for restricted entries.

Category kinds are `NAVIGATION`, `TOOL`, `SERVER`, and the reserved `CUSTOM_PAGE`. This phase renders the first three kinds.

## API

- The public endpoint returns only active public entries and never returns server entries.
- The authenticated endpoint filters entries for the current user; server entries are returned only to the super administrator.
- Management endpoints filter records for the actor and provide CRUD for content the actor may manage.
- Deleting a category that still contains entries returns a conflict instead of cascading content deletion.

## Frontend

- `/nav` loads `NAVIGATION` categories dynamically.
- `/tools` loads `TOOL` categories and adds `SERVER` categories only for the super administrator.
- `/admin/content` manages categories, entries, status, ordering, visibility, and role allowlists.
- Both administrator and super administrator account menus include Content Management; the administrator UI omits the server kind.

## Migration

The migration seeds the existing three public links, two authenticated tool placeholders, and one server-entry placeholder so deployment does not leave the portal empty.
