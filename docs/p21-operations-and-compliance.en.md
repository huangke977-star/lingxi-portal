# P21 Operational Resilience And Compliance

P21 turns backup, storage inspection, audit, upgrades, and release work into a recorded operational loop. The entry point is **Admin -> System overview**, available to super administrators.

## Implemented capabilities

- **Recovery drills**: the local drill creates a paired database/media backup, reads the archive, and verifies the database, media snapshot, and SHA-256 manifest without overwriting production. OSS/R2 drills verify the provider upload result when configured; missing configuration is recorded as blocked, never as success.
- **Alerts and escalation**: the overview checks database/remote backup failures, disk threshold breaches, missing files, and orphan files. Alerts retain first-seen time, last-seen time, occurrence count, acknowledgement, and resolution state. The path is acknowledge, preserve the record, follow the backup/disk/storage procedure, then resolve.
- **Audit retention**: audits are classified as business, security, or server. Defaults are 180, 365, and 90 days and can be changed by a super administrator from 7 to 3650 days. Sensitive fields are redacted at write time. Export is super-admin-only and limited to 10,000 filtered rows; CSV does not contain plaintext passwords, tokens, or secrets.
- **Dependency assessment**: the page reads API/Web `package.json` files and production Compose image versions, marking pinned, ranged, or unreadable entries with upgrade notes. It is an assessment, not an automatic production upgrade.
- **Recovery targets**: the page shows built-in RPO, RTO, media-integrity, and interface-degradation targets for comparison with drill results; these values are currently fixed on the server and have no admin configuration UI.
- **Load-test script**: `scripts/p21-load-test.mjs` is read-only and defaults to `/health`. Configure `P21_BASE_URL`, `P21_LOAD_PATHS`, `P21_CONCURRENCY`, `P21_DURATION_SECONDS`, and `P21_ACCESS_TOKEN` to measure request count, success rate, RPS, P50/P95/max latency, and sample errors.
- **Release and recovery**: release, migration, API/Web recreation, and container cleanup remain owned by Compose, GitHub Actions, 1Panel, or SSH; the Web API never receives host Docker access.
- **Backup list maintenance**: database backups can be deleted individually or selected for batch deletion; batch deletion uses one server-side lock and also removes matching media snapshots and verification records.

## Current OSS/R2 boundary

Without OSS/R2 credentials, local backup, paired media snapshots, manifests, and hash verification remain available and consume no remote network resources. Real off-site upload and remote-object download recovery require `BACKUP_ENCRYPTION_KEY`, a bucket, region/account ID, and least-privilege credentials. Configure and test the provider in the backup policy section, then run the matching drill. Acceptance records must distinguish local pass from remote pending configuration.

## Suggested acceptance order

1. Click **Check alerts** in System overview and confirm a check run is recorded.
2. Click **Local drill** and confirm a passed run containing the backup name, media verification, and `nonDestructive: true`.
3. With OSS/R2 unconfigured, inspect the remote drill state and confirm it is blocked rather than passed.
4. Change the audit retention values, save, and run **Clean now**; verify the deleted count and last-cleanup time.
5. Open Audit log, apply filters, and click **Export**. Confirm the download is redacted CSV; ordinary administrators can only see permitted business audits and cannot export security/server audits.
6. Run the read-only probe: `$env:P21_BASE_URL="https://your-domain"; $env:P21_LOAD_PATHS="/api/health"; $env:P21_DURATION_SECONDS="15"; pnpm p21:load-test`. Start production with concurrency 2 to 4 and never add write endpoints to the default probe.
7. Before dependency upgrades, back up database and media and retain current API/Web image tags. Roll back images on failure; apply only forward-compatible migrations.

## Operational boundary

The default drill is a non-destructive archive verification, not a production database overwrite. Final disaster-recovery acceptance still needs one isolated database/media restore with download, decryption, import, and sampled reads, with measured RTO/RPO recorded. Keep emergency contacts, external-service accounts, and keys in a protected operations system, never in the repository.
