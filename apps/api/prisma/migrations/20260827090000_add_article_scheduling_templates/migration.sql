ALTER TABLE `articles`
  ADD COLUMN `scheduled_publish_at` DATETIME(3) NULL,
  ADD COLUMN `scheduled_unpublish_at` DATETIME(3) NULL,
  ADD COLUMN `schedule_error` VARCHAR(500) NULL,
  ADD INDEX `articles_scheduled_publish_at_status_idx` (`scheduled_publish_at`, `status`),
  ADD INDEX `articles_scheduled_unpublish_at_status_idx` (`scheduled_unpublish_at`, `status`);

CREATE TABLE `article_templates` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `author_id` INTEGER NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `summary` VARCHAR(300) NOT NULL DEFAULT '',
  `content` LONGTEXT NOT NULL,
  `category` VARCHAR(80) NOT NULL DEFAULT '',
  `tags` VARCHAR(500) NOT NULL DEFAULT '',
  `title_color` VARCHAR(7) NOT NULL DEFAULT '',
  `visibility` ENUM('public', 'authenticated', 'role_restricted', 'private') NOT NULL DEFAULT 'public',
  `role_codes` VARCHAR(500) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `article_templates_author_id_name_key` (`author_id`, `name`),
  INDEX `article_templates_author_id_updated_at_idx` (`author_id`, `updated_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `article_templates_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
