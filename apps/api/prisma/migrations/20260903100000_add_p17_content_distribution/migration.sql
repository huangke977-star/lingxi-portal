-- P17: public content distribution and subscription email digests.
ALTER TABLE `mail_jobs`
  MODIFY `type` ENUM(
    'registration_verification',
    'account_email_verification',
    'device_login_verification',
    'password_reset',
    'login_risk',
    'security_notice',
    'subscription_digest'
  ) NOT NULL;

CREATE TABLE `subscription_email_preferences` (
  `user_id` INTEGER NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `unsubscribe_token` CHAR(64) NOT NULL,
  `unsubscribed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `subscription_email_preferences_unsubscribe_token_key` (`unsubscribe_token`),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `subscription_email_preferences_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `subscription_email_deliveries` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `day_key` CHAR(10) NOT NULL,
  `status` ENUM('pending', 'sending', 'sent', 'failed') NOT NULL DEFAULT 'pending',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `item_count` INTEGER NOT NULL DEFAULT 0,
  `article_ids` JSON NOT NULL,
  `last_error` VARCHAR(1000) NULL,
  `sent_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `subscription_email_deliveries_user_id_day_key_key` (`user_id`, `day_key`),
  INDEX `subscription_email_deliveries_status_created_at_idx` (`status`, `created_at`),
  INDEX `subscription_email_deliveries_user_id_created_at_idx` (`user_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `subscription_email_deliveries_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
