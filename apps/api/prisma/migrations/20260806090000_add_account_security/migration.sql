ALTER TABLE `users`
  ADD COLUMN `email_verified_at` DATETIME(3) NULL,
  ADD COLUMN `auth_version` INTEGER NOT NULL DEFAULT 0;

UPDATE `users`
SET `email_verified_at` = `created_at`
WHERE `email_verified_at` IS NULL;

CREATE TABLE `security_configurations` (
  `id` INTEGER NOT NULL DEFAULT 1,
  `smtp_enabled` BOOLEAN NOT NULL DEFAULT false,
  `smtp_host` VARCHAR(255) NULL,
  `smtp_port` INTEGER NOT NULL DEFAULT 587,
  `smtp_secure` BOOLEAN NOT NULL DEFAULT false,
  `smtp_username` VARCHAR(255) NULL,
  `smtp_password_encrypted` TEXT NULL,
  `smtp_from_name` VARCHAR(120) NOT NULL DEFAULT 'HLOVET',
  `smtp_from_email` VARCHAR(191) NULL,
  `registration_email_verification_enabled` BOOLEAN NOT NULL DEFAULT false,
  `password_recovery_enabled` BOOLEAN NOT NULL DEFAULT false,
  `turnstile_site_key` VARCHAR(255) NULL,
  `turnstile_secret_encrypted` TEXT NULL,
  `turnstile_registration_enabled` BOOLEAN NOT NULL DEFAULT false,
  `turnstile_login_enabled` BOOLEAN NOT NULL DEFAULT false,
  `turnstile_recovery_enabled` BOOLEAN NOT NULL DEFAULT false,
  `login_failure_turnstile_threshold` INTEGER NOT NULL DEFAULT 3,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_security_preferences` (
  `user_id` INTEGER NOT NULL,
  `login_alerts_enabled` BOOLEAN NOT NULL DEFAULT true,
  `email_alerts_enabled` BOOLEAN NOT NULL DEFAULT true,
  `new_device_alerts_enabled` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `known_login_devices` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `fingerprint` CHAR(64) NOT NULL,
  `label` VARCHAR(160) NOT NULL,
  `user_agent` VARCHAR(500) NOT NULL,
  `first_ip` VARCHAR(80) NOT NULL,
  `last_ip` VARCHAR(80) NOT NULL,
  `first_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `known_login_devices_user_id_fingerprint_key`(`user_id`, `fingerprint`),
  INDEX `known_login_devices_user_id_last_seen_at_idx`(`user_id`, `last_seen_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `login_security_events` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `type` ENUM('login_success', 'new_device', 'new_ip', 'unusual_frequency', 'login_blocked', 'password_reset', 'password_changed', 'email_verified') NOT NULL,
  `risk_level` ENUM('info', 'low', 'medium', 'high') NOT NULL DEFAULT 'info',
  `summary` VARCHAR(255) NOT NULL,
  `ip` VARCHAR(80) NOT NULL,
  `user_agent` VARCHAR(500) NOT NULL,
  `device_fingerprint` CHAR(64) NOT NULL,
  `device_label` VARCHAR(160) NOT NULL,
  `metadata` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `login_security_events_user_id_created_at_idx`(`user_id`, `created_at`),
  INDEX `login_security_events_type_risk_level_created_at_idx`(`type`, `risk_level`, `created_at`),
  INDEX `login_security_events_ip_created_at_idx`(`ip`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `email_verification_requests` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NULL,
  `purpose` ENUM('registration', 'account_email') NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `code_hash` CHAR(64) NOT NULL,
  `status` ENUM('pending', 'verified', 'consumed', 'expired') NOT NULL DEFAULT 'pending',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `ip` VARCHAR(80) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `verified_at` DATETIME(3) NULL,
  `consumed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `email_verification_requests_email_purpose_status_created_at_idx`(`email`, `purpose`, `status`, `created_at`),
  INDEX `email_verification_requests_user_id_created_at_idx`(`user_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `password_reset_requests` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `status` ENUM('pending', 'consumed', 'expired') NOT NULL DEFAULT 'pending',
  `ip` VARCHAR(80) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `consumed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `password_reset_requests_token_hash_key`(`token_hash`),
  INDEX `password_reset_requests_user_id_status_created_at_idx`(`user_id`, `status`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `mail_jobs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NULL,
  `type` ENUM('registration_verification', 'account_email_verification', 'password_reset', 'login_risk', 'security_notice') NOT NULL,
  `status` ENUM('pending', 'sending', 'sent', 'failed') NOT NULL DEFAULT 'pending',
  `recipient` VARCHAR(191) NOT NULL,
  `subject` VARCHAR(255) NOT NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `last_error` VARCHAR(1000) NULL,
  `metadata` JSON NULL,
  `sent_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `mail_jobs_status_created_at_idx`(`status`, `created_at`),
  INDEX `mail_jobs_user_id_created_at_idx`(`user_id`, `created_at`),
  INDEX `mail_jobs_recipient_created_at_idx`(`recipient`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_security_preferences`
  ADD CONSTRAINT `user_security_preferences_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `known_login_devices`
  ADD CONSTRAINT `known_login_devices_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `login_security_events`
  ADD CONSTRAINT `login_security_events_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `email_verification_requests`
  ADD CONSTRAINT `email_verification_requests_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `password_reset_requests`
  ADD CONSTRAINT `password_reset_requests_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `mail_jobs`
  ADD CONSTRAINT `mail_jobs_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
