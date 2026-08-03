# HLOVET Database Backup Operations

## Scope

- The super administrator can create, download, restore, and delete local backups from System Overview.
- Daily automatic backups use the `Asia/Shanghai` timezone.
- Local files are removed according to the configured retention period.
- Alibaba Cloud OSS and Cloudflare R2 can be enabled independently or together.
- Remote backups are encrypted client-side with AES-256-GCM and use the `.sql.gz.enc` suffix.
- Automatic backup or remote upload failures create a system notification and browser push for the super administrator.

## Required Server Configuration

`BACKUP_ENCRYPTION_KEY` must contain exactly 32 bytes. A 64-character hexadecimal key can be generated with:

```bash
openssl rand -hex 32
```

The same key protects stored remote credentials and encrypted backup files. Losing it makes existing remote backups and saved credentials unreadable. Keep an offline copy and never commit it to the repository.

## Alibaba Cloud OSS

1. Create a private Bucket, preferably using Standard storage.
2. Create a dedicated RAM user with list, upload, read, and delete permissions limited to the backup Bucket and prefix.
3. Enter the Region, Bucket, prefix, and RAM AccessKey in System Overview.
4. Save the configuration, test the saved credentials, and then enable OSS.

The Endpoint can normally remain empty so the OSS SDK derives it from the Region. Enter an HTTPS Endpoint only when a custom endpoint is required.

## Cloudflare R2

1. Create a private R2 Bucket.
2. Create an R2 API token limited to that Bucket.
3. Enter the Cloudflare Account ID, Bucket, prefix, Access Key ID, and Secret Access Key.
4. Save and test the connection before enabling R2.

## Retention

- Local retention only removes `.sql` and `.sql.gz` files from the server backup directory.
- Remote retention removes expired objects under the configured prefix after a successful upload.
- Pre-restore safety backups remain local so a remote provider failure cannot block a database restore.

## Restoring a Remote Backup

Download the `.enc` object from OSS or R2 and decrypt it with the repository script:

```bash
BACKUP_ENCRYPTION_KEY=<key> node scripts/decrypt-backup.mjs backup.sql.gz.enc backup.sql.gz
```

The decrypted file can then be restored from System Overview or with the MySQL client. Before a production restore, download and validate the latest current backup first.
