ALTER TABLE `user_reputation_ledgers`
  MODIFY COLUMN `reason` ENUM(
    'article_read',
    'article_comment',
    'article_publish',
    'article_liked',
    'author_subscribed',
    'resource_redeemed',
    'resource_sold',
    'article_report_accepted'
  ) NOT NULL;

ALTER TABLE `user_notifications`
  MODIFY COLUMN `type` ENUM(
    'friend_request_received',
    'friend_request_accepted',
    'friend_request_declined',
    'comment_report_resolved',
    'comment_report_rejected',
    'comment_author_moderated',
    'article_report_received',
    'article_report_resolved',
    'article_report_rejected',
    'article_author_moderated',
    'article_liked',
    'article_favorited',
    'article_commented',
    'comment_replied',
    'author_subscribed',
    'subscription_published',
    'announcement_published',
    'suggestion_updated',
    'article_appeal_received',
    'article_appeal_resolved',
    'feedback_updated',
    'article_publish_restricted',
    'system'
  ) NOT NULL;

CREATE TABLE `article_appeals` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `article_id` INTEGER NOT NULL,
  `author_id` INTEGER NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  `reviewed_by_id` INTEGER NULL,
  `reviewed_at` DATETIME(3) NULL,
  `resolution` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX `article_appeals_article_status_created_idx`(`article_id`, `status`, `created_at`),
  INDEX `article_appeals_author_status_created_idx`(`author_id`, `status`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `article_publish_restrictions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `source_report_id` INTEGER NULL,
  `created_by_id` INTEGER NULL,
  `lifted_by_id` INTEGER NULL,
  `reason` VARCHAR(500) NOT NULL,
  `starts_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `ends_at` DATETIME(3) NULL,
  `lifted_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX `article_publish_restrictions_user_active_idx`(`user_id`, `lifted_at`, `ends_at`),
  INDEX `article_publish_restrictions_source_report_idx`(`source_report_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_feedback` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `category` VARCHAR(40) NOT NULL,
  `title` VARCHAR(120) NOT NULL,
  `content` TEXT NOT NULL,
  `status` ENUM('pending', 'in_progress', 'resolved', 'closed') NOT NULL DEFAULT 'pending',
  `reviewed_by_id` INTEGER NULL,
  `reviewed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX `user_feedback_user_updated_idx`(`user_id`, `updated_at`),
  INDEX `user_feedback_status_updated_idx`(`status`, `updated_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_feedback_replies` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `feedback_id` INTEGER NOT NULL,
  `author_id` INTEGER NOT NULL,
  `content` TEXT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `user_feedback_replies_feedback_created_idx`(`feedback_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `article_appeals`
  ADD CONSTRAINT `article_appeals_article_id_fkey` FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `article_appeals_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `article_appeals_reviewed_by_id_fkey` FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `article_publish_restrictions`
  ADD CONSTRAINT `article_publish_restrictions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `article_publish_restrictions_source_report_id_fkey` FOREIGN KEY (`source_report_id`) REFERENCES `article_reports`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `article_publish_restrictions_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `article_publish_restrictions_lifted_by_id_fkey` FOREIGN KEY (`lifted_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `user_feedback`
  ADD CONSTRAINT `user_feedback_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `user_feedback_reviewed_by_id_fkey` FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `user_feedback_replies`
  ADD CONSTRAINT `user_feedback_replies_feedback_id_fkey` FOREIGN KEY (`feedback_id`) REFERENCES `user_feedback`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `user_feedback_replies_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
