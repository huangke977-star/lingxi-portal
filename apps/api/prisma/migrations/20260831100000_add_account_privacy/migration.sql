ALTER TABLE `users`
  MODIFY `status` ENUM('active', 'deletion_pending', 'disabled') NOT NULL DEFAULT 'active',
  ADD COLUMN `deletion_requested_at` DATETIME(3) NULL,
  ADD COLUMN `deletion_scheduled_at` DATETIME(3) NULL,
  ADD COLUMN `deleted_at` DATETIME(3) NULL,
  ADD COLUMN `deleted_original_username` VARCHAR(32) NULL,
  ADD COLUMN `deleted_original_nickname` VARCHAR(32) NULL,
  ADD COLUMN `deleted_original_email` VARCHAR(191) NULL;

CREATE TABLE `data_export_jobs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `status` ENUM('queued', 'processing', 'completed', 'failed', 'expired') NOT NULL DEFAULT 'queued',
  `payload` JSON NULL,
  `error_message` VARCHAR(500) NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `completed_at` DATETIME(3) NULL,
  `downloaded_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `data_export_jobs_user_id_created_at_idx`(`user_id`, `created_at`),
  INDEX `data_export_jobs_status_expires_at_idx`(`status`, `expires_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_totp_credentials` (
  `user_id` INTEGER NOT NULL,
  `encrypted_secret` TEXT NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `recovery_code_hashes` JSON NULL,
  `confirmed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `privacy_audit_records` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NULL,
  `action` VARCHAR(80) NOT NULL,
  `metadata` JSON NULL,
  `ip` VARCHAR(80) NULL,
  `user_agent` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `privacy_audit_records_user_id_created_at_idx`(`user_id`, `created_at`),
  INDEX `privacy_audit_records_action_created_at_idx`(`action`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `data_export_jobs`
  ADD CONSTRAINT `data_export_jobs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `user_totp_credentials`
  ADD CONSTRAINT `user_totp_credentials_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `privacy_audit_records`
  ADD CONSTRAINT `privacy_audit_records_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
