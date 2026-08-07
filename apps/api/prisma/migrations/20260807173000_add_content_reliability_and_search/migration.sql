ALTER TABLE `users`
  ADD COLUMN `search_text` VARCHAR(4096) NOT NULL DEFAULT '',
  ADD COLUMN `search_pinyin` VARCHAR(4096) NOT NULL DEFAULT '';

ALTER TABLE `portal_entries`
  ADD COLUMN `search_text` VARCHAR(4096) NOT NULL DEFAULT '',
  ADD COLUMN `search_pinyin` VARCHAR(4096) NOT NULL DEFAULT '';

ALTER TABLE `articles`
  ADD COLUMN `search_text` VARCHAR(4096) NOT NULL DEFAULT '',
  ADD COLUMN `search_pinyin` VARCHAR(4096) NOT NULL DEFAULT '';

CREATE TABLE `article_versions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `article_id` INTEGER NOT NULL,
  `editor_id` INTEGER NULL,
  `version_number` INTEGER NOT NULL,
  `source` ENUM('autosave', 'manual', 'publish', 'restore') NOT NULL,
  `title` VARCHAR(120) NOT NULL,
  `summary` VARCHAR(300) NOT NULL DEFAULT '',
  `content` LONGTEXT NOT NULL,
  `category` VARCHAR(80) NOT NULL DEFAULT '',
  `tags` VARCHAR(500) NOT NULL DEFAULT '',
  `title_color` VARCHAR(7) NOT NULL DEFAULT '',
  `visibility` ENUM('public', 'authenticated', 'role_restricted', 'private') NOT NULL,
  `status` ENUM('draft', 'published', 'unpublished', 'blocked', 'deleted') NOT NULL,
  `role_codes` VARCHAR(500) NOT NULL DEFAULT '',
  `content_hash` CHAR(64) NOT NULL,
  `changed_fields` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `article_versions_article_id_version_number_key` (`article_id`, `version_number`),
  INDEX `article_versions_article_id_created_at_idx` (`article_id`, `created_at`),
  INDEX `article_versions_editor_id_idx` (`editor_id`),
  INDEX `article_versions_source_created_at_idx` (`source`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `article_versions_article_id_fkey` FOREIGN KEY (`article_id`) REFERENCES `articles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `article_versions_editor_id_fkey` FOREIGN KEY (`editor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `search_history` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `keyword` VARCHAR(80) NOT NULL,
  `normalized_key` VARCHAR(80) NOT NULL,
  `search_count` INTEGER NOT NULL DEFAULT 1,
  `last_searched_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `search_history_user_id_normalized_key_key` (`user_id`, `normalized_key`),
  INDEX `search_history_user_id_last_searched_at_idx` (`user_id`, `last_searched_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `search_history_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `search_keyword_stats` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `keyword` VARCHAR(80) NOT NULL,
  `normalized_key` VARCHAR(80) NOT NULL,
  `search_count` INTEGER NOT NULL DEFAULT 1,
  `last_searched_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `search_keyword_stats_normalized_key_key` (`normalized_key`),
  INDEX `search_keyword_stats_search_count_last_searched_at_idx` (`search_count`, `last_searched_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
