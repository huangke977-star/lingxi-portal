# HLOVET Global Background Management Design

## Goals

- Every theme shares one global background selected by the super administrator.
- Personal theme preferences only control colors and card transparency.
- The super administrator can upload, inspect, activate, and permanently delete images.
- Uploaded files survive container recreation.

## Authorization

- `GET /backgrounds/active` and `GET /backgrounds/files/:storedName` are public.
- Listing, upload, activation, and deletion use both `JwtAuthGuard` and `SuperAdminGuard`.
- The management page lives at `/admin/backgrounds` and is not linked from the public portal.

## Data And Files

- The MySQL `background_images` table stores original and randomized names, MIME type, size, active state, uploader, and timestamps.
- Files are written to `BACKGROUND_UPLOAD_DIR`. Docker mounts the `background_uploads` named volume at `/app/uploads/backgrounds` by default.
- Stored names use UUIDs, and client-provided filesystem paths are never accepted.
- JPEG, PNG, WebP, and AVIF are accepted up to 10 MB per image.
- The API verifies MIME type, extension, and binary file signature.

## State Behavior

- Uploading adds an image to the library without replacing the current background.
- Activation clears the previous active state and selects the new image in one database transaction.
- Deleting the active upload does not select another upload automatically; the portal returns to the bundled default.
- Deletion removes the physical file before deleting the database record. A missing file does not prevent stale metadata cleanup.

## Frontend Behavior

- `ThemeController` loads the public active-background endpoint and sets the global `--portal-bg-image` CSS variable.
- Themes no longer override the background image variable.
- Activating or deleting the current background dispatches an in-page refresh event, so no new login is required.
- The management page displays thumbnails, file size, upload date, uploader, and active state.

## Verification

- Regular users cannot use management endpoints.
- Non-image content with a forged MIME type is rejected.
- Only one image remains active after consecutive selections.
- Database metadata and the physical file are both removed on deletion.
- Deleting the active upload makes the public endpoint return `null`, allowing the bundled default to take over.
