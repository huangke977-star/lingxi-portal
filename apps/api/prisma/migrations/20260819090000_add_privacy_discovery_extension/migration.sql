ALTER TABLE `user_profile_settings`
  ADD COLUMN `profile_access` ENUM('public', 'authenticated', 'friends', 'private') NOT NULL DEFAULT 'public' AFTER `show_pinned_content`,
  ADD COLUMN `searchable` BOOLEAN NOT NULL DEFAULT true AFTER `profile_access`,
  ADD COLUMN `friend_request_policy` ENUM('everyone', 'none') NOT NULL DEFAULT 'everyone' AFTER `searchable`,
  ADD COLUMN `direct_message_policy` ENUM('everyone', 'request', 'friends', 'none') NOT NULL DEFAULT 'request' AFTER `friend_request_policy`,
  ADD COLUMN `group_invitation_policy` ENUM('everyone', 'friends', 'none') NOT NULL DEFAULT 'everyone' AFTER `direct_message_policy`;

ALTER TABLE `conversations`
  ADD COLUMN `direct_user_one_id` INTEGER NULL AFTER `friendship_id`,
  ADD COLUMN `direct_user_two_id` INTEGER NULL AFTER `direct_user_one_id`,
  ADD UNIQUE INDEX `conversations_direct_user_one_id_direct_user_two_id_key`(`direct_user_one_id`, `direct_user_two_id`);

CREATE TABLE `stranger_message_requests` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `requester_id` INTEGER NOT NULL,
  `recipient_id` INTEGER NOT NULL,
  `conversation_id` INTEGER NULL,
  `body` VARCHAR(500) NOT NULL,
  `status` ENUM('pending', 'accepted', 'declined', 'cancelled') NOT NULL DEFAULT 'pending',
  `responded_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `stranger_message_requests_requester_id_recipient_id_key`(`requester_id`, `recipient_id`),
  INDEX `stranger_message_requests_recipient_id_status_updated_at_idx`(`recipient_id`, `status`, `updated_at`),
  INDEX `stranger_message_requests_requester_id_status_updated_at_idx`(`requester_id`, `status`, `updated_at`),
  INDEX `stranger_message_requests_conversation_id_idx`(`conversation_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `article_topic_subscriptions` (
  `user_id` INTEGER NOT NULL,
  `topic_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `article_topic_subscriptions_topic_id_created_at_idx`(`topic_id`, `created_at`),
  PRIMARY KEY (`user_id`, `topic_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `article_collection_subscriptions` (
  `user_id` INTEGER NOT NULL,
  `collection_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `article_collection_subscriptions_collection_id_created_at_idx`(`collection_id`, `created_at`),
  PRIMARY KEY (`user_id`, `collection_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_notifications`
  ADD COLUMN `stranger_message_request_id` INTEGER NULL AFTER `friendship_id`,
  ADD INDEX `user_notifications_stranger_message_request_id_idx`(`stranger_message_request_id`);

ALTER TABLE `conversations`
  ADD CONSTRAINT `conversations_direct_user_one_id_fkey` FOREIGN KEY (`direct_user_one_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `conversations_direct_user_two_id_fkey` FOREIGN KEY (`direct_user_two_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `stranger_message_requests`
  ADD CONSTRAINT `stranger_message_requests_requester_id_fkey` FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `stranger_message_requests_recipient_id_fkey` FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `stranger_message_requests_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `user_notifications`
  ADD CONSTRAINT `user_notifications_stranger_message_request_id_fkey` FOREIGN KEY (`stranger_message_request_id`) REFERENCES `stranger_message_requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `article_topic_subscriptions`
  ADD CONSTRAINT `article_topic_subscriptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `article_topic_subscriptions_topic_id_fkey` FOREIGN KEY (`topic_id`) REFERENCES `article_topics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `article_collection_subscriptions`
  ADD CONSTRAINT `article_collection_subscriptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `article_collection_subscriptions_collection_id_fkey` FOREIGN KEY (`collection_id`) REFERENCES `article_collections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
