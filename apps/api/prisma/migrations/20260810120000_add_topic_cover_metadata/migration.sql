ALTER TABLE `article_topics`
  ADD COLUMN `cover_original_name` VARCHAR(255) NULL,
  ADD COLUMN `cover_stored_name` VARCHAR(255) NULL,
  ADD COLUMN `cover_mime_type` VARCHAR(100) NULL,
  ADD COLUMN `cover_size_bytes` INTEGER NULL;

CREATE UNIQUE INDEX `article_topics_cover_stored_name_key`
  ON `article_topics`(`cover_stored_name`);
