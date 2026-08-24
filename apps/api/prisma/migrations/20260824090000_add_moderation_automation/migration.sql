CREATE TABLE `moderation_rules` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(80) NOT NULL,
  `type` ENUM('sensitive_word', 'link_rate', 'duplicate_content', 'high_frequency') NOT NULL,
  `action` ENUM('record', 'block') NOT NULL DEFAULT 'record',
  `sources` VARCHAR(80) NOT NULL DEFAULT 'article,comment,group_message',
  `keywords` TEXT NULL,
  `threshold` INTEGER NOT NULL DEFAULT 1,
  `window_seconds` INTEGER NOT NULL DEFAULT 60,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `created_by_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `moderation_rule_hits` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `rule_id` INTEGER NOT NULL,
  `actor_id` INTEGER NOT NULL,
  `source` ENUM('article', 'comment', 'group_message') NOT NULL,
  `action` ENUM('record', 'block') NOT NULL,
  `content_preview` VARCHAR(240) NOT NULL,
  `detail` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `moderation_content_records` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `source` ENUM('article', 'comment', 'group_message') NOT NULL,
  `content_ref` VARCHAR(80) NOT NULL,
  `content_hash` CHAR(64) NOT NULL,
  `link_count` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `moderation_templates` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(80) NOT NULL,
  `status` VARCHAR(20) NOT NULL,
  `content` VARCHAR(500) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `created_by_id` INTEGER NULL,
  `updated_by_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `moderation_settings` (
  `id` INTEGER NOT NULL,
  `deadline_hours` INTEGER NOT NULL DEFAULT 24,
  `reminder_lead_hours` INTEGER NOT NULL DEFAULT 4,
  `automatic_reminders_enabled` BOOLEAN NOT NULL DEFAULT true,
  `updated_by_id` INTEGER NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `moderation_deadline_notices` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `source` ENUM('article', 'comment', 'group_message') NOT NULL,
  `report_id` INTEGER NOT NULL,
  `stage` ENUM('approaching', 'overdue') NOT NULL,
  `due_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `moderation_rules_enabled_type_idx` ON `moderation_rules`(`enabled`, `type`);
CREATE INDEX `moderation_rule_hits_created_at_idx` ON `moderation_rule_hits`(`created_at`);
CREATE INDEX `moderation_rule_hits_rule_id_created_at_idx` ON `moderation_rule_hits`(`rule_id`, `created_at`);
CREATE INDEX `moderation_rule_hits_actor_id_created_at_idx` ON `moderation_rule_hits`(`actor_id`, `created_at`);
CREATE UNIQUE INDEX `moderation_content_records_source_content_ref_key` ON `moderation_content_records`(`source`, `content_ref`);
CREATE INDEX `moderation_content_records_user_id_source_created_at_idx` ON `moderation_content_records`(`user_id`, `source`, `created_at`);
CREATE INDEX `moderation_content_records_user_id_source_content_hash_created_at_idx` ON `moderation_content_records`(`user_id`, `source`, `content_hash`, `created_at`);
CREATE INDEX `moderation_templates_enabled_status_idx` ON `moderation_templates`(`enabled`, `status`);
CREATE UNIQUE INDEX `moderation_deadline_notices_source_report_id_stage_key` ON `moderation_deadline_notices`(`source`, `report_id`, `stage`);
CREATE INDEX `moderation_deadline_notices_created_at_idx` ON `moderation_deadline_notices`(`created_at`);

ALTER TABLE `moderation_rules` ADD CONSTRAINT `moderation_rules_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `moderation_rule_hits` ADD CONSTRAINT `moderation_rule_hits_rule_id_fkey` FOREIGN KEY (`rule_id`) REFERENCES `moderation_rules`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `moderation_rule_hits` ADD CONSTRAINT `moderation_rule_hits_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `moderation_content_records` ADD CONSTRAINT `moderation_content_records_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `moderation_templates` ADD CONSTRAINT `moderation_templates_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `moderation_templates` ADD CONSTRAINT `moderation_templates_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
