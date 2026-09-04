-- P19: signed webhooks, read-only API tokens, external channels, and OIDC identities.
ALTER TABLE `users` ADD COLUMN `username_changed_at` DATETIME(3) NULL;

CREATE TABLE `external_webhook_endpoints` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `owner_id` INTEGER NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `url` VARCHAR(512) NOT NULL,
  `secret_encrypted` TEXT NOT NULL,
  `events` JSON NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `last_delivered_at` DATETIME(3) NULL,
  `last_error` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX `external_webhook_endpoints_owner_id_enabled_idx` (`owner_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `external_webhook_endpoints_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `external_webhook_deliveries` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `endpoint_id` INTEGER NOT NULL,
  `event_id` VARCHAR(120) NOT NULL,
  `event_type` VARCHAR(80) NOT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `payload` JSON NOT NULL,
  `status` ENUM('pending','delivered','failed') NOT NULL DEFAULT 'pending',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `next_attempt_at` DATETIME(3) NULL,
  `delivered_at` DATETIME(3) NULL,
  `last_error` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `external_webhook_deliveries_endpoint_id_idempotency_key_key` (`endpoint_id`,`idempotency_key`),
  INDEX `external_webhook_deliveries_status_next_attempt_at_idx` (`status`,`next_attempt_at`),
  INDEX `external_webhook_deliveries_endpoint_id_created_at_idx` (`endpoint_id`,`created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `external_webhook_deliveries_endpoint_id_fkey` FOREIGN KEY (`endpoint_id`) REFERENCES `external_webhook_endpoints`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `read_only_api_tokens` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `token_prefix` VARCHAR(20) NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `scopes` JSON NOT NULL,
  `expires_at` DATETIME(3) NULL,
  `last_used_at` DATETIME(3) NULL,
  `revoked_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `read_only_api_tokens_token_hash_key` (`token_hash`),
  INDEX `read_only_api_tokens_user_id_revoked_at_expires_at_idx` (`user_id`,`revoked_at`,`expires_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `read_only_api_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `external_auth_identities` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `provider` ENUM('google') NOT NULL,
  `subject` VARCHAR(255) NOT NULL,
  `email` VARCHAR(191) NULL,
  `email_verified` BOOLEAN NOT NULL DEFAULT false,
  `profile` JSON NULL,
  `last_login_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `external_auth_identities_provider_subject_key` (`provider`,`subject`),
  INDEX `external_auth_identities_user_id_provider_idx` (`user_id`,`provider`),
  INDEX `external_auth_identities_provider_email_idx` (`provider`,`email`),
  PRIMARY KEY (`id`),
  CONSTRAINT `external_auth_identities_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `external_notification_channels` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `kind` VARCHAR(32) NOT NULL,
  `endpoint` VARCHAR(512) NOT NULL,
  `secret_encrypted` TEXT NULL,
  `preferences` JSON NOT NULL,
  `verification_code_hash` CHAR(64) NULL,
  `verification_expires_at` DATETIME(3) NULL,
  `verified_at` DATETIME(3) NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `failure_count` INTEGER NOT NULL DEFAULT 0,
  `last_error` VARCHAR(1000) NULL,
  `last_delivered_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX `external_notification_channels_user_id_kind_enabled_idx` (`user_id`,`kind`,`enabled`),
  PRIMARY KEY (`id`),
  CONSTRAINT `external_notification_channels_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
