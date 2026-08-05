CREATE TABLE `media_backup_jobs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `status` ENUM('pending', 'running', 'completed', 'partial', 'failed') NOT NULL DEFAULT 'pending',
  `trigger` ENUM('manual', 'scheduled') NOT NULL,
  `triggered_by_id` INTEGER NULL,
  `providers` JSON NOT NULL,
  `total_files` INTEGER NOT NULL DEFAULT 0,
  `processed_files` INTEGER NOT NULL DEFAULT 0,
  `uploaded_files` INTEGER NOT NULL DEFAULT 0,
  `reused_files` INTEGER NOT NULL DEFAULT 0,
  `skipped_files` INTEGER NOT NULL DEFAULT 0,
  `failed_files` INTEGER NOT NULL DEFAULT 0,
  `total_bytes` BIGINT NOT NULL DEFAULT 0,
  `uploaded_bytes` BIGINT NOT NULL DEFAULT 0,
  `error` VARCHAR(500) NULL,
  `started_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `media_backup_jobs_status_created_at_idx`(`status`, `created_at`),
  INDEX `media_backup_jobs_trigger_created_at_idx`(`trigger`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `media_backup_files` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `category` VARCHAR(40) NOT NULL,
  `stored_name` VARCHAR(512) NOT NULL,
  `mime_type` VARCHAR(127) NULL,
  `source_type` VARCHAR(64) NOT NULL,
  `source_id` VARCHAR(80) NULL,
  `source_label` VARCHAR(255) NOT NULL,
  `source_url` VARCHAR(512) NULL,
  `uploaded_by` VARCHAR(80) NULL,
  `size_bytes` INTEGER NOT NULL,
  `content_hash` CHAR(64) NULL,
  `file_updated_at` DATETIME(3) NULL,
  `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_backed_up_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `media_backup_files_category_stored_name_key`(`category`, `stored_name`),
  INDEX `media_backup_files_content_hash_size_bytes_idx`(`content_hash`, `size_bytes`),
  INDEX `media_backup_files_last_seen_at_idx`(`last_seen_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `media_backup_manifests` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `job_id` INTEGER NOT NULL,
  `file_id` INTEGER NOT NULL,
  `provider` ENUM('oss', 'r2') NOT NULL,
  `status` ENUM('pending', 'uploaded', 'reused', 'skipped', 'failed') NOT NULL DEFAULT 'pending',
  `content_hash` CHAR(64) NOT NULL,
  `size_bytes` INTEGER NOT NULL,
  `file_updated_at` DATETIME(3) NULL,
  `bucket` VARCHAR(128) NULL,
  `object_key` VARCHAR(512) NULL,
  `etag` VARCHAR(255) NULL,
  `error` VARCHAR(500) NULL,
  `started_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `media_backup_manifests_job_id_file_id_provider_key`(`job_id`, `file_id`, `provider`),
  INDEX `media_backup_manifest_job_status_idx`(`job_id`, `status`),
  INDEX `media_backup_manifest_lookup_idx`(`file_id`, `provider`, `content_hash`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `media_backup_manifests`
  ADD CONSTRAINT `media_backup_manifests_job_id_fkey`
  FOREIGN KEY (`job_id`) REFERENCES `media_backup_jobs`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `media_backup_manifests`
  ADD CONSTRAINT `media_backup_manifests_file_id_fkey`
  FOREIGN KEY (`file_id`) REFERENCES `media_backup_files`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
