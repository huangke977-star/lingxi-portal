CREATE TABLE `background_images` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `original_name` VARCHAR(255) NOT NULL,
  `stored_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(64) NOT NULL,
  `size_bytes` INTEGER NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT false,
  `uploaded_by_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `background_images_stored_name_key`(`stored_name`),
  INDEX `background_images_is_active_idx`(`is_active`),
  INDEX `background_images_uploaded_by_id_idx`(`uploaded_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `background_images`
  ADD CONSTRAINT `background_images_uploaded_by_id_fkey`
  FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
