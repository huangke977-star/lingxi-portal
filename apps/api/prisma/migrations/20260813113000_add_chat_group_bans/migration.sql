ALTER TABLE `chat_groups`
    ADD COLUMN `is_banned` BOOLEAN NOT NULL DEFAULT FALSE AFTER `dissolved_at`,
    ADD COLUMN `banned_until` DATETIME(3) NULL AFTER `is_banned`,
    ADD COLUMN `ban_reason` VARCHAR(300) NULL AFTER `banned_until`;

CREATE TABLE `chat_group_ban_records` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `group_id` INTEGER NOT NULL,
    `actor_id` INTEGER NOT NULL,
    `lifted_by_id` INTEGER NULL,
    `reason` VARCHAR(300) NOT NULL,
    `starts_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NULL,
    `lifted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `chat_group_ban_records_group_id_created_at_idx`(`group_id`, `created_at`),
    INDEX `chat_group_ban_records_group_id_lifted_at_expires_at_idx`(`group_id`, `lifted_at`, `expires_at`),
    PRIMARY KEY (`id`),
    CONSTRAINT `chat_group_ban_records_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `chat_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `chat_group_ban_records_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `chat_group_ban_records_lifted_by_id_fkey` FOREIGN KEY (`lifted_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
);
