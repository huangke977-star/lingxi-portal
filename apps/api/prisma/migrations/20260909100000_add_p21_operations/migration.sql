CREATE TABLE `audit_retention_policies` (
  `id` INTEGER NOT NULL DEFAULT 1,
  `cleanup_enabled` BOOLEAN NOT NULL DEFAULT true,
  `business_days` INTEGER NOT NULL DEFAULT 180,
  `security_days` INTEGER NOT NULL DEFAULT 365,
  `server_days` INTEGER NOT NULL DEFAULT 90,
  `last_cleanup_at` DATETIME(3) NULL,
  `last_cleanup_count` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `operational_runs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `kind` VARCHAR(48) NOT NULL,
  `status` VARCHAR(24) NOT NULL,
  `provider` VARCHAR(16) NULL,
  `summary` VARCHAR(255) NOT NULL,
  `detail` JSON NULL,
  `metrics` JSON NULL,
  `actor_id` INTEGER NULL,
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `operational_runs_kind_created_at_idx` (`kind`, `created_at`),
  INDEX `operational_runs_status_created_at_idx` (`status`, `created_at`),
  CONSTRAINT `operational_runs_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `operational_alerts` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `type` VARCHAR(48) NOT NULL,
  `fingerprint` VARCHAR(191) NOT NULL,
  `severity` VARCHAR(16) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'open',
  `title` VARCHAR(160) NOT NULL,
  `message` VARCHAR(500) NOT NULL,
  `metadata` JSON NULL,
  `occurrence_count` INTEGER NOT NULL DEFAULT 1,
  `first_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `acknowledged_at` DATETIME(3) NULL,
  `acknowledged_by_id` INTEGER NULL,
  `resolved_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `operational_alerts_type_fingerprint_key` (`type`, `fingerprint`),
  INDEX `operational_alerts_status_severity_last_seen_at_idx` (`status`, `severity`, `last_seen_at`),
  CONSTRAINT `operational_alerts_acknowledged_by_id_fkey` FOREIGN KEY (`acknowledged_by_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
