ALTER TABLE `user_notifications`
  MODIFY COLUMN `type` ENUM(
    'friend_request_received',
    'friend_request_accepted',
    'friend_request_declined',
    'comment_report_resolved',
    'comment_report_rejected',
    'comment_author_moderated',
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

CREATE TABLE `site_suggestions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `title` VARCHAR(120) NOT NULL,
  `content` TEXT NOT NULL,
  `status` ENUM('pending', 'scheduled', 'in_progress', 'completed', 'rejected') NOT NULL DEFAULT 'pending',
  `reviewed_by_id` INTEGER NULL,
  `reviewed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `site_suggestions_status_updated_at_idx`(`status`, `updated_at`),
  INDEX `site_suggestions_user_id_updated_at_idx`(`user_id`, `updated_at`),
  CONSTRAINT `site_suggestions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `site_suggestions_reviewed_by_id_fkey` FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE `site_suggestion_replies` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `suggestion_id` INTEGER NOT NULL,
  `author_id` INTEGER NOT NULL,
  `content` TEXT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `site_suggestion_replies_suggestion_id_created_at_idx`(`suggestion_id`, `created_at`),
  CONSTRAINT `site_suggestion_replies_suggestion_id_fkey` FOREIGN KEY (`suggestion_id`) REFERENCES `site_suggestions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `site_suggestion_replies_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE `anonymous_topics` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(120) NOT NULL,
  `status` ENUM('active', 'closed') NOT NULL DEFAULT 'active',
  `is_hidden` BOOLEAN NOT NULL DEFAULT false,
  `message_count` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `anonymous_topics_status_is_hidden_updated_at_idx`(`status`, `is_hidden`, `updated_at`)
);

CREATE TABLE `anonymous_topic_identities` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `topic_id` INTEGER NOT NULL,
  `nickname` VARCHAR(32) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `is_creator` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `anonymous_topic_identities_topic_id_nickname_key`(`topic_id`, `nickname`),
  INDEX `anonymous_topic_identities_topic_id_created_at_idx`(`topic_id`, `created_at`),
  CONSTRAINT `anonymous_topic_identities_topic_id_fkey` FOREIGN KEY (`topic_id`) REFERENCES `anonymous_topics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE `anonymous_topic_messages` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `topic_id` INTEGER NOT NULL,
  `sequence` INTEGER NOT NULL,
  `identity_id` INTEGER NULL,
  `body` TEXT NOT NULL,
  `is_hidden` BOOLEAN NOT NULL DEFAULT false,
  `like_count` INTEGER NOT NULL DEFAULT 0,
  `dislike_count` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `anonymous_topic_messages_topic_id_sequence_key`(`topic_id`, `sequence`),
  INDEX `anonymous_topic_messages_topic_id_is_hidden_sequence_idx`(`topic_id`, `is_hidden`, `sequence`),
  CONSTRAINT `anonymous_topic_messages_topic_id_fkey` FOREIGN KEY (`topic_id`) REFERENCES `anonymous_topics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `anonymous_topic_messages_identity_id_fkey` FOREIGN KEY (`identity_id`) REFERENCES `anonymous_topic_identities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE `anonymous_topic_reactions` (
  `message_id` INTEGER NOT NULL,
  `visitor_key` CHAR(64) NOT NULL,
  `value` ENUM('up', 'down') NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`message_id`, `visitor_key`),
  INDEX `anonymous_topic_reactions_visitor_key_updated_at_idx`(`visitor_key`, `updated_at`),
  CONSTRAINT `anonymous_topic_reactions_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `anonymous_topic_messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
);
