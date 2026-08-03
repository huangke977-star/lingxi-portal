CREATE TABLE `backup_configurations` (
  `id` INTEGER NOT NULL DEFAULT 1,
  `automatic_enabled` BOOLEAN NOT NULL DEFAULT false,
  `schedule_time` CHAR(5) NOT NULL DEFAULT '03:00',
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  `local_retention_days` INTEGER NOT NULL DEFAULT 7,
  `remote_retention_days` INTEGER NOT NULL DEFAULT 90,
  `oss_enabled` BOOLEAN NOT NULL DEFAULT false,
  `oss_region` VARCHAR(80) NULL,
  `oss_endpoint` VARCHAR(255) NULL,
  `oss_bucket` VARCHAR(128) NULL,
  `oss_prefix` VARCHAR(255) NOT NULL DEFAULT 'database',
  `oss_access_key_id_encrypted` TEXT NULL,
  `oss_access_key_secret_encrypted` TEXT NULL,
  `r2_enabled` BOOLEAN NOT NULL DEFAULT false,
  `r2_account_id` VARCHAR(64) NULL,
  `r2_bucket` VARCHAR(128) NULL,
  `r2_prefix` VARCHAR(255) NOT NULL DEFAULT 'database',
  `r2_access_key_id_encrypted` TEXT NULL,
  `r2_secret_access_key_encrypted` TEXT NULL,
  `last_automatic_backup_date` CHAR(10) NULL,
  `last_success_at` DATETIME(3) NULL,
  `last_failure_at` DATETIME(3) NULL,
  `last_failure_message` VARCHAR(500) NULL,
  `last_backup_name` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `backup_configurations` (`id`, `updated_at`)
VALUES (1, CURRENT_TIMESTAMP(3));
