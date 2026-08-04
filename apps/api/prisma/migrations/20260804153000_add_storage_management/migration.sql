CREATE TABLE `storage_management_configurations` (
  `id` INTEGER NOT NULL DEFAULT 1,
  `automatic_scan_enabled` BOOLEAN NOT NULL DEFAULT true,
  `scan_time` CHAR(5) NOT NULL DEFAULT '04:00',
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  `trash_retention_days` INTEGER NOT NULL DEFAULT 7,
  `warning_threshold_percent` INTEGER NOT NULL DEFAULT 75,
  `last_scheduled_scan_date` CHAR(10) NULL,
  `last_scan_at` DATETIME(3) NULL,
  `last_warning_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `storage_scans` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `status` ENUM('running', 'completed', 'failed') NOT NULL DEFAULT 'running',
  `trigger` ENUM('manual', 'scheduled') NOT NULL,
  `triggered_by_id` INTEGER NULL,
  `summary` JSON NULL,
  `error` VARCHAR(500) NULL,
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `storage_scans_status_created_at_idx`(`status`, `created_at`),
  INDEX `storage_scans_created_at_idx`(`created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `storage_scan_issues` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `scan_id` INTEGER NOT NULL,
  `kind` ENUM('missing', 'orphan', 'metadata_mismatch') NOT NULL,
  `category` VARCHAR(40) NOT NULL,
  `stored_name` VARCHAR(512) NOT NULL,
  `mime_type` VARCHAR(127) NULL,
  `expected_size_bytes` INTEGER NULL,
  `actual_size_bytes` INTEGER NULL,
  `source_type` VARCHAR(64) NOT NULL,
  `source_id` VARCHAR(80) NULL,
  `source_label` VARCHAR(255) NOT NULL,
  `source_url` VARCHAR(512) NULL,
  `uploaded_by` VARCHAR(80) NULL,
  `file_updated_at` DATETIME(3) NULL,
  `resolved_at` DATETIME(3) NULL,
  `resolution` VARCHAR(40) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `storage_scan_issues_scan_id_resolved_at_kind_category_idx`(`scan_id`, `resolved_at`, `kind`, `category`),
  INDEX `storage_scan_issues_category_stored_name_idx`(`category`, `stored_name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `storage_trash_items` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `category` VARCHAR(40) NOT NULL,
  `original_stored_name` VARCHAR(512) NOT NULL,
  `trash_stored_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(127) NULL,
  `size_bytes` INTEGER NOT NULL,
  `trashed_by_id` INTEGER NULL,
  `deleted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `purge_after` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `storage_trash_items_trash_stored_name_key`(`trash_stored_name`),
  INDEX `storage_trash_items_purge_after_idx`(`purge_after`),
  INDEX `storage_trash_items_category_deleted_at_idx`(`category`, `deleted_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `storage_scan_issues`
  ADD CONSTRAINT `storage_scan_issues_scan_id_fkey`
  FOREIGN KEY (`scan_id`) REFERENCES `storage_scans`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO `storage_management_configurations` (`id`, `updated_at`)
VALUES (1, CURRENT_TIMESTAMP(3));
