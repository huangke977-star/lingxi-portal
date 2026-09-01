CREATE TABLE `webauthn_credentials` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `credential_id` VARCHAR(512) NOT NULL,
  `public_key` TEXT NOT NULL,
  `counter` INTEGER NOT NULL DEFAULT 0,
  `transports` JSON NULL,
  `name` VARCHAR(120) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_used_at` DATETIME(3) NULL,

  UNIQUE INDEX `webauthn_credentials_credential_id_key`(`credential_id`),
  INDEX `webauthn_credentials_user_id_created_at_idx`(`user_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `webauthn_credentials_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
