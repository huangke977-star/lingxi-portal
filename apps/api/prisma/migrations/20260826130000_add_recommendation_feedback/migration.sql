CREATE TABLE `recommendation_feedback` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `target_type` ENUM('article', 'topic', 'collection', 'author', 'group') NOT NULL,
  `target_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `recommendation_feedback_user_id_target_type_target_id_key` (`user_id`, `target_type`, `target_id`),
  INDEX `recommendation_feedback_target_type_target_id_idx` (`target_type`, `target_id`),
  INDEX `recommendation_feedback_user_id_created_at_idx` (`user_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `recommendation_feedback_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
