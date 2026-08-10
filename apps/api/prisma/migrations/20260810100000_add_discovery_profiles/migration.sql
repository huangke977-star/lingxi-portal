ALTER TABLE `user_subscriptions`
  ADD COLUMN `notify_new_articles` BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE `subscription_feed_reads` (
  `user_id` INTEGER NOT NULL,
  `article_id` INTEGER NOT NULL,
  `read_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `subscription_feed_reads_article_id_idx` (`article_id`),
  INDEX `subscription_feed_reads_user_id_read_at_idx` (`user_id`, `read_at`),
  PRIMARY KEY (`user_id`, `article_id`),
  CONSTRAINT `subscription_feed_reads_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `subscription_feed_reads_article_id_fkey` FOREIGN KEY (`article_id`) REFERENCES `articles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `article_collections` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `owner_id` INTEGER NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `description` VARCHAR(300) NOT NULL DEFAULT '',
  `visibility` ENUM('public', 'authenticated', 'role_restricted', 'private') NOT NULL DEFAULT 'public',
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `article_collections_owner_id_sort_order_updated_at_idx` (`owner_id`, `sort_order`, `updated_at`),
  INDEX `article_collections_visibility_updated_at_idx` (`visibility`, `updated_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `article_collections_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `article_collection_items` (
  `collection_id` INTEGER NOT NULL,
  `article_id` INTEGER NOT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `article_collection_items_collection_id_sort_order_idx` (`collection_id`, `sort_order`),
  INDEX `article_collection_items_article_id_idx` (`article_id`),
  PRIMARY KEY (`collection_id`, `article_id`),
  CONSTRAINT `article_collection_items_collection_id_fkey` FOREIGN KEY (`collection_id`) REFERENCES `article_collections` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `article_collection_items_article_id_fkey` FOREIGN KEY (`article_id`) REFERENCES `articles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `article_topics` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(80) NOT NULL,
  `slug` VARCHAR(120) NOT NULL,
  `description` VARCHAR(500) NOT NULL DEFAULT '',
  `cover_path` VARCHAR(512) NULL,
  `visibility` ENUM('public', 'authenticated', 'role_restricted') NOT NULL DEFAULT 'public',
  `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `created_by_id` INTEGER NOT NULL,
  `updated_by_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `article_topics_slug_key` (`slug`),
  INDEX `article_topics_status_sort_order_updated_at_idx` (`status`, `sort_order`, `updated_at`),
  INDEX `article_topics_visibility_idx` (`visibility`),
  INDEX `article_topics_created_by_id_idx` (`created_by_id`),
  INDEX `article_topics_updated_by_id_idx` (`updated_by_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `article_topics_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `article_topics_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `article_topic_allowed_roles` (
  `topic_id` INTEGER NOT NULL,
  `role_id` INTEGER NOT NULL,
  INDEX `article_topic_allowed_roles_role_id_idx` (`role_id`),
  PRIMARY KEY (`topic_id`, `role_id`),
  CONSTRAINT `article_topic_allowed_roles_topic_id_fkey` FOREIGN KEY (`topic_id`) REFERENCES `article_topics` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `article_topic_allowed_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `article_topic_items` (
  `topic_id` INTEGER NOT NULL,
  `article_id` INTEGER NOT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `article_topic_items_topic_id_sort_order_idx` (`topic_id`, `sort_order`),
  INDEX `article_topic_items_article_id_idx` (`article_id`),
  PRIMARY KEY (`topic_id`, `article_id`),
  CONSTRAINT `article_topic_items_topic_id_fkey` FOREIGN KEY (`topic_id`) REFERENCES `article_topics` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `article_topic_items_article_id_fkey` FOREIGN KEY (`article_id`) REFERENCES `articles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_profile_settings` (
  `user_id` INTEGER NOT NULL,
  `show_bio` BOOLEAN NOT NULL DEFAULT true,
  `show_joined_at` BOOLEAN NOT NULL DEFAULT true,
  `show_stats` BOOLEAN NOT NULL DEFAULT true,
  `show_following_count` BOOLEAN NOT NULL DEFAULT true,
  `show_pinned_content` BOOLEAN NOT NULL DEFAULT true,
  `pinned_article_id` INTEGER NULL,
  `pinned_collection_id` INTEGER NULL,
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `user_profile_settings_pinned_article_id_idx` (`pinned_article_id`),
  INDEX `user_profile_settings_pinned_collection_id_idx` (`pinned_collection_id`),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `user_profile_settings_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `user_profile_settings_pinned_article_id_fkey` FOREIGN KEY (`pinned_article_id`) REFERENCES `articles` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `user_profile_settings_pinned_collection_id_fkey` FOREIGN KEY (`pinned_collection_id`) REFERENCES `article_collections` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `profile_visits` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `profile_user_id` INTEGER NOT NULL,
  `visitor_key` CHAR(64) NOT NULL,
  `visited_on` VARCHAR(10) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `profile_visits_profile_user_id_visitor_key_visited_on_key` (`profile_user_id`, `visitor_key`, `visited_on`),
  INDEX `profile_visits_profile_user_id_created_at_idx` (`profile_user_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `profile_visits_profile_user_id_fkey` FOREIGN KEY (`profile_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
