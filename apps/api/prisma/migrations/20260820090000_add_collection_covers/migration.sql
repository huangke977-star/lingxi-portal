ALTER TABLE `article_collections`
  ADD COLUMN `cover_path` VARCHAR(512) NULL,
  ADD COLUMN `cover_original_name` VARCHAR(255) NULL,
  ADD COLUMN `cover_stored_name` VARCHAR(255) NULL,
  ADD COLUMN `cover_mime_type` VARCHAR(100) NULL,
  ADD COLUMN `cover_size_bytes` INT NULL;

CREATE UNIQUE INDEX `article_collections_cover_stored_name_key`
  ON `article_collections`(`cover_stored_name`);
