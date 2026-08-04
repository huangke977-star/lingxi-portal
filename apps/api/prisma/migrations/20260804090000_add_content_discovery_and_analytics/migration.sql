-- Account-level reading collections.
CREATE TABLE `article_read_later` (
  `article_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `article_read_later_user_id_created_at_idx`(`user_id`, `created_at`),
  PRIMARY KEY (`article_id`, `user_id`),
  CONSTRAINT `article_read_later_article_id_fkey` FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `article_read_later_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `article_reading_history` (
  `article_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `progress` INTEGER NOT NULL DEFAULT 1,
  `last_read_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `article_reading_history_user_id_last_read_at_idx`(`user_id`, `last_read_at`),
  PRIMARY KEY (`article_id`, `user_id`),
  CONSTRAINT `article_reading_history_article_id_fkey` FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `article_reading_history_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Date-range analytics use these indexes instead of scanning interaction tables.
CREATE INDEX `users_created_at_idx` ON `users`(`created_at`);
CREATE INDEX `articles_published_at_idx` ON `articles`(`published_at`);
CREATE INDEX `article_likes_created_at_idx` ON `article_likes`(`created_at`);
CREATE INDEX `article_favorites_created_at_idx` ON `article_favorites`(`created_at`);
CREATE INDEX `article_views_created_at_idx` ON `article_views`(`created_at`);
CREATE INDEX `user_subscriptions_created_at_idx` ON `user_subscriptions`(`created_at`);
CREATE INDEX `article_comments_created_at_idx` ON `article_comments`(`created_at`);
