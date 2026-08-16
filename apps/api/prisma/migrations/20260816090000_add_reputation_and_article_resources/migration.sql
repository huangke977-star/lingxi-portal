ALTER TABLE `users`
  ADD COLUMN `experience` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `points` INTEGER NOT NULL DEFAULT 0;

ALTER TABLE `articles`
  ADD COLUMN `is_point_resource` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `point_cost` INTEGER NOT NULL DEFAULT 0;

ALTER TABLE `article_versions`
  ADD COLUMN `is_point_resource` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `point_cost` INTEGER NOT NULL DEFAULT 0;

CREATE TABLE `user_reputation_ledgers` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `reason` ENUM('article_read', 'article_comment', 'article_publish', 'article_liked', 'author_subscribed', 'resource_redeemed', 'resource_sold') NOT NULL,
  `event_key` VARCHAR(191) NOT NULL,
  `experience_delta` INTEGER NOT NULL DEFAULT 0,
  `point_delta` INTEGER NOT NULL DEFAULT 0,
  `experience_after` INTEGER NOT NULL,
  `points_after` INTEGER NOT NULL,
  `description` VARCHAR(255) NOT NULL,
  `metadata` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `user_reputation_ledgers_user_id_event_key_key`(`user_id`, `event_key`),
  INDEX `user_reputation_ledgers_user_id_created_at_idx`(`user_id`, `created_at`),
  INDEX `user_reputation_ledgers_reason_created_at_idx`(`reason`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `article_resource_exchanges` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `article_id` INTEGER NOT NULL,
  `buyer_id` INTEGER NOT NULL,
  `author_id` INTEGER NOT NULL,
  `point_cost` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `article_resource_exchanges_article_id_buyer_id_key`(`article_id`, `buyer_id`),
  INDEX `article_resource_exchanges_buyer_id_created_at_idx`(`buyer_id`, `created_at`),
  INDEX `article_resource_exchanges_author_id_created_at_idx`(`author_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_reputation_ledgers`
  ADD CONSTRAINT `user_reputation_ledgers_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `article_resource_exchanges`
  ADD CONSTRAINT `article_resource_exchanges_article_id_fkey`
  FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `article_resource_exchanges_buyer_id_fkey`
  FOREIGN KEY (`buyer_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `article_resource_exchanges_author_id_fkey`
  FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
