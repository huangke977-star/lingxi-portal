CREATE TABLE `site_assets` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `kind` ENUM('logo', 'pwa_icon') NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `stored_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(80) NOT NULL,
  `size_bytes` INTEGER NOT NULL,
  `uploaded_by_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `site_assets_stored_name_key`(`stored_name`),
  INDEX `site_assets_kind_created_at_idx`(`kind`, `created_at`),
  INDEX `site_assets_uploaded_by_id_idx`(`uploaded_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `site_assets`
  ADD CONSTRAINT `site_assets_uploaded_by_id_fkey`
  FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `conversation_participant_states`
  ADD COLUMN `muted` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `user_notification_channel_states`
  ADD COLUMN `push_enabled` BOOLEAN NOT NULL DEFAULT true;
