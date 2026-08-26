CREATE TABLE `user_growth_preferences` (
  `user_id` INT NOT NULL,
  `onboarding_completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `user_growth_preferences_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE `user_notification_channel_states`
  ADD COLUMN `digest_enabled` BOOLEAN NOT NULL DEFAULT true;

UPDATE `articles`
SET `is_point_resource` = true
WHERE `content` LIKE '%:::resource{points=%';

UPDATE `article_versions`
SET `is_point_resource` = true
WHERE `content` LIKE '%:::resource{points=%';
