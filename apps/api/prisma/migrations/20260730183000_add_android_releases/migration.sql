CREATE TABLE `android_releases` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `version_name` VARCHAR(40) NOT NULL,
  `version_code` INTEGER NOT NULL,
  `channel` VARCHAR(40) NOT NULL DEFAULT 'stable',
  `original_name` VARCHAR(255) NOT NULL,
  `stored_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(80) NOT NULL,
  `size_bytes` INTEGER NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `release_notes` TEXT NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT false,
  `uploaded_by_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `android_releases_stored_name_key`(`stored_name`),
  INDEX `android_releases_is_active_updated_at_idx`(`is_active`, `updated_at`),
  INDEX `android_releases_version_code_idx`(`version_code`),
  INDEX `android_releases_uploaded_by_id_idx`(`uploaded_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `android_releases`
  ADD CONSTRAINT `android_releases_uploaded_by_id_fkey`
  FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
