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
    'system'
  ) NOT NULL;

ALTER TABLE `user_reputation_ledgers`
  ADD COLUMN `pending_point_delta` INTEGER NOT NULL DEFAULT 0 AFTER `point_delta`,
  ADD COLUMN `available_at` DATETIME(3) NULL AFTER `metadata`,
  ADD COLUMN `settled_at` DATETIME(3) NULL AFTER `available_at`;

ALTER TABLE `article_resource_exchanges`
  ADD COLUMN `block_key` VARCHAR(80) NOT NULL DEFAULT 'legacy' AFTER `author_id`,
  ADD COLUMN `seller_available_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER `point_cost`,
  ADD COLUMN `seller_settled_at` DATETIME(3) NULL AFTER `seller_available_at`;

CREATE INDEX `article_resource_exchanges_article_id_idx`
  ON `article_resource_exchanges`(`article_id`);
DROP INDEX `article_resource_exchanges_article_id_buyer_id_key` ON `article_resource_exchanges`;
CREATE UNIQUE INDEX `article_resource_exchanges_article_id_buyer_id_block_key_key`
  ON `article_resource_exchanges`(`article_id`, `buyer_id`, `block_key`);
CREATE INDEX `article_resource_author_settle_idx`
  ON `article_resource_exchanges`(`author_id`, `seller_settled_at`, `seller_available_at`);

CREATE TABLE `article_reports` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `article_id` INTEGER NOT NULL,
  `reporter_id` INTEGER NOT NULL,
  `reason` ENUM('spam', 'harassment', 'illegal', 'privacy', 'misinformation', 'other') NOT NULL,
  `detail` VARCHAR(500) NULL,
  `status` ENUM('pending', 'resolved', 'rejected') NOT NULL DEFAULT 'pending',
  `handled_by_id` INTEGER NULL,
  `handled_at` DATETIME(3) NULL,
  `resolution` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `article_reports_article_id_reporter_id_key`(`article_id`, `reporter_id`),
  INDEX `article_reports_status_created_at_idx`(`status`, `created_at`),
  INDEX `article_reports_reporter_id_idx`(`reporter_id`),
  INDEX `article_reports_handled_by_id_idx`(`handled_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_notifications`
  ADD COLUMN `article_report_id` INTEGER NULL AFTER `comment_report_id`,
  ADD INDEX `user_notifications_article_report_id_idx`(`article_report_id`);

ALTER TABLE `article_reports`
  ADD CONSTRAINT `article_reports_article_id_fkey`
    FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `article_reports_reporter_id_fkey`
    FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `article_reports_handled_by_id_fkey`
    FOREIGN KEY (`handled_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `user_notifications`
  ADD CONSTRAINT `user_notifications_article_report_id_fkey`
    FOREIGN KEY (`article_report_id`) REFERENCES `article_reports`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
