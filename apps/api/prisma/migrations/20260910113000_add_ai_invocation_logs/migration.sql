CREATE TABLE `ai_invocation_logs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NULL,
  `operation` VARCHAR(64) NOT NULL,
  `provider` VARCHAR(32) NOT NULL,
  `model` VARCHAR(160) NOT NULL,
  `status` VARCHAR(24) NOT NULL,
  `prompt_tokens` INTEGER NULL,
  `completion_tokens` INTEGER NULL,
  `total_tokens` INTEGER NULL,
  `duration_ms` INTEGER NOT NULL,
  `estimated_cost_micros` INTEGER NULL,
  `error_summary` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ai_invocation_logs_created_at_idx` (`created_at`),
  INDEX `ai_invocation_logs_user_id_created_at_idx` (`user_id`, `created_at`),
  INDEX `ai_invocation_logs_status_created_at_idx` (`status`, `created_at`),
  CONSTRAINT `ai_invocation_logs_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
