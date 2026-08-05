ALTER TABLE `backup_configurations`
  ADD COLUMN `last_media_backup_date` CHAR(10) NULL;

ALTER TABLE `media_backup_manifests`
  ADD COLUMN `attempt_count` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `last_attempt_at` DATETIME(3) NULL;

CREATE INDEX `media_backup_manifest_content_idx`
  ON `media_backup_manifests`(`provider`, `content_hash`, `size_bytes`, `status`);

CREATE TABLE `media_backup_job_logs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `job_id` INTEGER NOT NULL,
  `level` ENUM('info', 'warning', 'error') NOT NULL DEFAULT 'info',
  `event` VARCHAR(64) NOT NULL,
  `message` VARCHAR(500) NOT NULL,
  `file_id` INTEGER NULL,
  `provider` ENUM('oss', 'r2') NULL,
  `attempt` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `media_backup_job_logs_job_id_id_idx`(`job_id`, `id`),
  INDEX `media_backup_job_logs_level_created_at_idx`(`level`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `storage_file_repairs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `issue_id` INTEGER NULL,
  `category` VARCHAR(40) NOT NULL,
  `stored_name` VARCHAR(512) NOT NULL,
  `source_type` VARCHAR(64) NOT NULL,
  `source_id` VARCHAR(80) NULL,
  `action` ENUM('remote_restore', 'reupload', 'confirm_unrecoverable') NOT NULL,
  `status` ENUM('running', 'completed', 'failed') NOT NULL DEFAULT 'running',
  `provider` ENUM('oss', 'r2') NULL,
  `manifest_id` INTEGER NULL,
  `actor_id` INTEGER NULL,
  `original_name` VARCHAR(255) NULL,
  `mime_type` VARCHAR(127) NULL,
  `size_bytes` INTEGER NULL,
  `expected_hash` CHAR(64) NULL,
  `actual_hash` CHAR(64) NULL,
  `note` VARCHAR(500) NULL,
  `error` VARCHAR(500) NULL,
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `storage_file_repairs_category_stored_name_created_at_idx`(`category`, `stored_name`, `created_at`),
  INDEX `storage_file_repairs_issue_id_created_at_idx`(`issue_id`, `created_at`),
  INDEX `storage_file_repairs_status_created_at_idx`(`status`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `media_backup_job_logs`
  ADD CONSTRAINT `media_backup_job_logs_job_id_fkey`
  FOREIGN KEY (`job_id`) REFERENCES `media_backup_jobs`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `storage_file_repairs`
  ADD CONSTRAINT `storage_file_repairs_issue_id_fkey`
  FOREIGN KEY (`issue_id`) REFERENCES `storage_scan_issues`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
