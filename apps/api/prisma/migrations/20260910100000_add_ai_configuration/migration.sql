CREATE TABLE `ai_configurations` (
  `id` INTEGER NOT NULL DEFAULT 1,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `provider` VARCHAR(32) NOT NULL DEFAULT 'openai-compatible',
  `base_url` VARCHAR(512) NULL,
  `model` VARCHAR(160) NULL,
  `api_key_encrypted` TEXT NULL,
  `global_concurrency` INTEGER NOT NULL DEFAULT 2,
  `user_concurrency` INTEGER NOT NULL DEFAULT 1,
  `max_output_tokens` INTEGER NOT NULL DEFAULT 2000,
  `request_timeout_seconds` INTEGER NOT NULL DEFAULT 60,
  `daily_request_limit` INTEGER NOT NULL DEFAULT 0,
  `billing_currency` VARCHAR(8) NOT NULL DEFAULT 'USD',
  `input_cost_per_million_micros` INTEGER NOT NULL DEFAULT 0,
  `output_cost_per_million_micros` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
