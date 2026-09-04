-- P18: explainable recommendations, recoverable feedback, and resource delivery accounting.
ALTER TABLE `user_reputation_ledgers`
  MODIFY COLUMN `reason` ENUM(
    'article_read',
    'article_comment',
    'article_publish',
    'article_liked',
    'author_subscribed',
    'resource_redeemed',
    'resource_sold',
    'article_report_accepted',
    'points_top_up',
    'resource_refund',
    'violation_penalty'
  ) NOT NULL;

ALTER TABLE `article_resource_exchanges`
  ADD COLUMN `delivery_status` ENUM('unlocked', 'downloaded', 'failed', 'refunded') NOT NULL DEFAULT 'unlocked' AFTER `seller_settled_at`,
  ADD COLUMN `attempt_count` INTEGER NOT NULL DEFAULT 0 AFTER `delivery_status`,
  ADD COLUMN `last_error` VARCHAR(1000) NULL AFTER `attempt_count`,
  ADD COLUMN `downloaded_at` DATETIME(3) NULL AFTER `last_error`,
  ADD COLUMN `refunded_at` DATETIME(3) NULL AFTER `downloaded_at`,
  ADD COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) AFTER `created_at`;

CREATE INDEX `article_resource_exchanges_delivery_status_created_at_idx`
  ON `article_resource_exchanges`(`delivery_status`, `created_at`);

CREATE TABLE `article_resource_delivery_events` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `exchange_id` INTEGER NOT NULL,
  `type` ENUM('redeemed', 'unlocked', 'downloaded', 'failed', 'retry', 'refunded') NOT NULL,
  `attempt` INTEGER NOT NULL DEFAULT 0,
  `detail` VARCHAR(1000) NULL,
  `event_key` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `article_resource_delivery_events_event_key_key` (`event_key`),
  INDEX `article_resource_delivery_events_exchange_id_created_at_idx` (`exchange_id`, `created_at`),
  INDEX `article_resource_delivery_events_type_created_at_idx` (`type`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `article_resource_delivery_events_exchange_id_fkey`
    FOREIGN KEY (`exchange_id`) REFERENCES `article_resource_exchanges`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
