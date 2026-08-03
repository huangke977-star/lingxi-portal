ALTER TABLE `user_notifications`
  ADD COLUMN `push_delivered_at` DATETIME(3) NULL;

UPDATE `user_notifications`
  SET `push_delivered_at` = COALESCE(`updated_at`, `created_at`)
  WHERE `push_delivered_at` IS NULL;

CREATE INDEX `user_notifications_push_delivered_at_id_idx`
  ON `user_notifications`(`push_delivered_at`, `id`);

CREATE TABLE `push_subscriptions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `endpoint_hash` CHAR(64) NOT NULL,
  `endpoint` TEXT NOT NULL,
  `p256dh` VARCHAR(255) NOT NULL,
  `auth` VARCHAR(255) NOT NULL,
  `user_agent` VARCHAR(500) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `push_subscriptions_endpoint_hash_key`(`endpoint_hash`),
  INDEX `push_subscriptions_user_id_updated_at_idx`(`user_id`, `updated_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `push_subscriptions_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `audit_logs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `actor_id` INTEGER NULL,
  `actor_username` VARCHAR(32) NOT NULL,
  `actor_nickname` VARCHAR(32) NOT NULL,
  `action` VARCHAR(120) NOT NULL,
  `scope` VARCHAR(24) NOT NULL,
  `method` VARCHAR(10) NOT NULL,
  `path` VARCHAR(512) NOT NULL,
  `target_type` VARCHAR(80) NULL,
  `target_id` VARCHAR(120) NULL,
  `summary` VARCHAR(255) NOT NULL,
  `metadata` JSON NULL,
  `ip` VARCHAR(80) NOT NULL DEFAULT '',
  `user_agent` VARCHAR(500) NOT NULL DEFAULT '',
  `status_code` INTEGER NOT NULL,
  `duration_ms` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `audit_logs_scope_created_at_idx`(`scope`, `created_at`),
  INDEX `audit_logs_actor_id_created_at_idx`(`actor_id`, `created_at`),
  INDEX `audit_logs_action_created_at_idx`(`action`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `audit_logs_actor_id_fkey`
    FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
