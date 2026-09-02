-- P16: mentions, quoted content, message search/pins and tag subscriptions.
ALTER TABLE `article_comments`
  ADD COLUMN `quoted_comment_id` INTEGER NULL,
  ADD COLUMN `quoted_body` TEXT NULL,
  ADD COLUMN `quoted_author_name` VARCHAR(120) NULL,
  ADD COLUMN `quoted_created_at` DATETIME(3) NULL,
  ADD INDEX `article_comments_quoted_comment_id_idx` (`quoted_comment_id`),
  ADD CONSTRAINT `article_comments_quoted_comment_id_fkey`
    FOREIGN KEY (`quoted_comment_id`) REFERENCES `article_comments` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `chat_messages`
  ADD COLUMN `quoted_message_id` INTEGER NULL,
  ADD COLUMN `quoted_body` TEXT NULL,
  ADD COLUMN `quoted_sender_name` VARCHAR(120) NULL,
  ADD COLUMN `quoted_created_at` DATETIME(3) NULL,
  ADD COLUMN `is_pinned` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `pin_order` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `pinned_at` DATETIME(3) NULL,
  ADD INDEX `chat_messages_quoted_message_id_idx` (`quoted_message_id`),
  ADD INDEX `chat_messages_conversation_id_is_pinned_pin_order_idx` (`conversation_id`, `is_pinned`, `pin_order`),
  ADD CONSTRAINT `chat_messages_quoted_message_id_fkey`
    FOREIGN KEY (`quoted_message_id`) REFERENCES `chat_messages` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `user_notifications`
  ADD COLUMN `message_id` INTEGER NULL,
  ADD INDEX `user_notifications_message_id_idx` (`message_id`),
  ADD CONSTRAINT `user_notifications_message_id_fkey`
    FOREIGN KEY (`message_id`) REFERENCES `chat_messages` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `user_subscriptions`
  ADD COLUMN `frequency` ENUM('instant', 'daily', 'muted') NOT NULL DEFAULT 'instant';

ALTER TABLE `article_topic_subscriptions`
  ADD COLUMN `frequency` ENUM('instant', 'daily', 'muted') NOT NULL DEFAULT 'instant';

CREATE TABLE `article_tag_subscriptions` (
  `user_id` INTEGER NOT NULL,
  `tag` VARCHAR(80) NOT NULL,
  `frequency` ENUM('instant', 'daily', 'muted') NOT NULL DEFAULT 'instant',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `article_tag_subscriptions_tag_created_at_idx` (`tag`, `created_at`),
  PRIMARY KEY (`user_id`, `tag`),
  CONSTRAINT `article_tag_subscriptions_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
