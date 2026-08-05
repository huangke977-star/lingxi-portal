# HLOVET Media Backup And Recovery

- Status: Phase 1 implementation guide
- Scope: backgrounds, site assets, Android packages, avatars, article images, and chat attachments
- Chinese version: `docs/media-backup-and-recovery.zh-CN.md`

## 1. Goals

Media backup processes only persistent files that are referenced by the database and physically present on disk. Missing references, orphan files, temporary uploads, and trash remain in the storage-repair workflow and never enter a normal backup as healthy candidates.

Jobs use one worker and process files sequentially by default. This keeps memory, disk, and network pressure bounded on the VPS and prevents login, article, or chat requests from depending on backup completion.

## 2. File Lifecycle

1. A storage scan compares database references with physical files.
2. Valid files from all six categories synchronize into the media catalog.
3. A job decides whether a stored hash can be reused from size and modification time.
4. Files requiring a hash are streamed through SHA-256.
5. Content already present for a provider is reused; otherwise it is encrypted and uploaded.
6. Every job, provider, and file produces a manifest record.
7. Restore downloads into staging, decrypts, and verifies SHA-256 and size.
8. Only verified content atomically replaces the destination, and the resolution is recorded.

## 3. Incremental And Exclusion Rules

- Reuse a hash when file size and modification time are unchanged.
- Do not re-upload a hash that already has a successful manifest for the same provider.
- Different paths with identical bytes may reuse one remote object.
- Exclude `.tmp`, `.trash`, incomplete uploads, and catalog entries not seen by the latest scan.
- A file deleted, replaced, or modified during hashing or upload is skipped or failed without persisting an invalid hash.
- Default concurrency is one and must not be raised to a level that harms production traffic.

## 4. Remote Configuration

Media backup reuses the encrypted Alibaba Cloud OSS / Cloudflare R2 settings in System Overview and the server-side `BACKUP_ENCRYPTION_KEY`. APIs never return plaintext credentials.

Run a connection test before enabling a provider. At least one provider must be enabled for a real remote media job. With no provider enabled, catalog coverage remains visible, but the system must not report a remote job as successful.

Objects remain private and are encrypted with AES-256-GCM. Restore requires the same `BACKUP_ENCRYPTION_KEY` used when the object was created.

## 5. Scheduling, Retention, And Retry

- Super administrators can start manual jobs from System Overview.
- Scheduled jobs use the saved timezone and execution time and catch up once after a service restart when today's run is missing.
- Only one media backup job may run at a time.
- Database and media backups share one I/O channel. A scheduled job that finds the channel busy is deferred and retried by the next scheduler pass instead of being recorded as failed.
- File upload failures use limited retries with increasing delays, never an unbounded retry loop.
- Local jobs and manifests follow retention policy; a remote object still referenced by a retained manifest must not be removed.
- Every job records trigger, providers, file counts, upload/reuse/skip/failure counts, bytes, timestamps, and a bounded error summary.

## 6. Missing-File Resolution

Storage Management offers three actions for missing files:

1. Remote restore: select an available backup, download to staging, verify hash and size, then replace.
2. Replacement upload: write the new upload to staging, verify it, then replace the original path.
3. Confirm loss: retain the business record and close the current issue with an explicit resolution.

A later scan always checks physical state again. A business record that still points to a file confirmed as unrecoverable remains visible in scan history and missing-file statistics, but the same file is not reopened in the pending queue. A later successful replacement upload or remote restore supersedes that confirmation.

## 7. Lightweight Observability

The application stores bounded windows of slow requests, recent API errors, memory, and disk samples without adding an always-running monitoring product.

- Slow-request records contain method, normalized path, status, duration, and time, never credentials or request bodies.
- Recent errors contain status, normalized path, and a bounded error summary.
- Memory and disk trends are sampled at fixed intervals with bounded retention.
- System Overview shows coverage, uncovered files, latest success, failures, and storage issue counts.

## 8. Notifications

The existing system notification channel alerts super administrators when:

- a media job fails or only partially succeeds;
- disk usage reaches the configured storage threshold;
- the missing-file count changes between completed scans.

Cooldown and deduplication prevent alert floods. Notifications include navigation context and bounded errors but never cloud credentials.

## 9. Restore Drill

Use a replaceable test file in production, never a unique business file.

1. Verify that one remote provider passes its connection test and is enabled.
2. Run a storage scan and confirm that the test file enters the catalog.
3. Run media backup and confirm that its manifest is uploaded or reused.
4. Record the file SHA-256 and size.
5. Move the test file to a separate safe directory to create a recoverable missing state.
6. Restore the missing item from Storage Management.
7. Recompute SHA-256 and size; both must match step 4.
8. Run a full storage scan and confirm the missing issue is gone.

Without remote credentials, only catalog, hash, manifest, and local staging checks can pass. Do not record that as a successful remote restore drill.

## 10. Failure Handling

- Long-running job: inspect the current file and last update before restarting anything; do not restart MySQL, Redis, Caddy, or TURN.
- Provider failure: use the connection test to verify permission, bucket, endpoint, and VPS egress.
- Hash mismatch: preserve staged data for diagnosis and never overwrite the destination.
- Disk pressure: disable automatic media backup, clean trash and approved orphan files, then resume.
- Lost encryption key: existing encrypted remote objects cannot be restored; back up the key separately as a server secret.
