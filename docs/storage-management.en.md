# Storage Management

## Entry And Access

- The storage distribution panel in System Overview shows a health summary and links to Storage Management.
- The detailed page is available at `/admin/storage`.
- System overview, scan results, file preview, trash operations, and scan policy are restricted to the super administrator.

## Scan Scope

The scan covers these persistent directories:

- Global backgrounds
- Site assets such as logos and PWA icons
- Android packages
- User avatars
- Article images
- Chat attachments

Each disk file is compared with its database record and classified as:

- **Missing**: the database record exists but the disk file does not.
- **Orphaned**: the disk file exists but no database record references it.
- **Metadata mismatch**: the recorded file size differs from the actual disk size.

Files in temporary upload directories are protected for 24 hours. A scan checks at most 50,000 files and uses asynchronous filesystem operations. System Overview reads the latest persisted summary instead of recursively scanning directories during refresh.

## Trash

- Only orphaned files from a scan result can be moved to trash.
- The backend checks again that the file is still unreferenced before moving it.
- Files move into a hidden `.trash` directory inside their existing upload volume and are not deleted immediately.
- A file can be restored during the retention period or deleted permanently by the super administrator.
- The background scheduler permanently removes expired trash files and records.

## Scheduled Scans And Alerts

Default settings:

- Daily automatic scan: enabled
- Scan time: `04:00`
- Time zone: `Asia/Shanghai`
- Trash retention: 7 days
- Disk warning threshold: 75%

The system sends a system notification to super administrators when disk usage reaches the threshold or missing files are detected. Equivalent warnings are rate-limited to once every 24 hours.

## API

- `GET /admin/system/storage`: storage overview
- `POST /admin/system/storage/scans`: start a scan
- `GET /admin/system/storage/scans/:id`: read scan status
- `GET /admin/system/storage/issues`: list issues with pagination
- `GET /admin/system/storage/issues/:id/file`: preview or download an orphaned file
- `POST /admin/system/storage/issues/:id/trash`: move a file to trash
- `GET /admin/system/storage/trash`: list trash with pagination
- `POST /admin/system/storage/trash/:id/restore`: restore a file
- `DELETE /admin/system/storage/trash/:id`: permanently delete a file
- `GET /admin/system/storage/configuration`: read scan policy
- `POST /admin/system/storage/configuration`: update scan policy

## Verification

1. Sign in as the super administrator and confirm that System Overview includes a Storage Management link.
2. Open Storage Management, start a scan, and confirm that the page polls until the result is complete.
3. Verify issue type filters, category filters, search, and pagination.
4. Preview and download a previewable orphaned image.
5. Move a test orphaned file to trash and confirm that it disappears from the original directory.
6. Restore the file, scan again, and confirm that the file is reported as orphaned again.
7. Move it to trash again and permanently delete it.
8. Change the schedule, retention period, and warning threshold, then refresh and confirm that the values persist.
9. Access `/admin/storage` as a regular administrator and confirm that access is denied.
