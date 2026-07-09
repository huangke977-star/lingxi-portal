# Super Admin User Password Reset Design

Date: 2026-07-09

## Goal

Add a password reset action to the existing admin user-management page so accounts with `isSuperAdmin = true` can set a new password for any user, while keeping user deletion unavailable.

## Scope

This phase includes:

- Add `PATCH /users/:id/password` to the API.
- Keep the route protected by `JwtAuthGuard` and `SuperAdminGuard`; only super admins can call it.
- Validate the new password through a DTO with a minimum length of 8 characters.
- Hash the new password with the existing `PasswordService` before writing `passwordHash`.
- Return only public user data; never return the password hash.
- Add a "修改密码" action and confirmation modal to the `/admin` user table.
- Validate matching password confirmation in the frontend before submit.
- Keep deletion unavailable: no delete API and no delete button.

This phase does not include:

- Self-service password changes for ordinary users.
- Password recovery, email verification, or multi-factor confirmation.
- User deletion, bulk deletion, or soft deletion.
- Role CRUD.

## Design

The backend extends the existing users management module instead of adding a separate password module. `UsersController` adds `PATCH /users/:id/password` with a request body of `{ "password": "new-password" }`. `UsersService` injects `PasswordService`, hashes the new password, updates the target user's `passwordHash`, and returns the existing `AuthenticatedUser` shape.

The frontend `/admin` page adds a "修改密码" button to each row's action area. Clicking it opens an in-page modal that shows the target account and asks for the new password plus confirmation. On success, the modal closes and a success notice is shown. On failure, the page shows an error without keeping or echoing the password.

User deletion remains unavailable: this change does not create a delete endpoint, does not add a delete button, and does not keep a hidden deletion entry point in the UI.

## Permissions And Security

- Only accounts with `isSuperAdmin = true` can call the password reset route.
- An ordinary `administrator` role without super admin status cannot call the route.
- Passwords are not written to logs, page notices, documentation, or chat.
- The backend enforces authorization through guards; frontend visibility is not trusted.
- Responses must not include `passwordHash`.

## Acceptance Criteria

- A super admin can set a new password for any account from the admin page.
- A non-super-admin request to `PATCH /users/:id/password` returns 403.
- A password shorter than 8 characters returns 400.
- The password reset response does not include `passwordHash`.
- The `/admin` page has no delete button and includes a "修改密码" button.
- API tests, API lint, Web lint, and production build pass.
