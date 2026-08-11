-- Extend the existing chat conversation without moving private-chat data.
ALTER TABLE `conversations`
    ADD COLUMN `kind` ENUM('direct', 'group', 'temporary') NOT NULL DEFAULT 'direct',
    MODIFY `friendship_id` INTEGER NULL;

ALTER TABLE `conversation_participant_states`
    ADD COLUMN `last_read_message_id` INTEGER NULL;

-- Existing direct chats start with the latest message as their per-user cursor.
UPDATE `conversation_participant_states` AS `state`
LEFT JOIN (
    SELECT `conversation_id`, MAX(`id`) AS `last_message_id`
    FROM `chat_messages`
    GROUP BY `conversation_id`
) AS `latest` ON `latest`.`conversation_id` = `state`.`conversation_id`
SET `state`.`last_read_message_id` = `latest`.`last_message_id`;

CREATE TABLE `chat_groups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversation_id` INTEGER NOT NULL,
    `owner_id` INTEGER NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `announcement` VARCHAR(1000) NOT NULL DEFAULT '',
    `avatar_url` VARCHAR(500) NULL,
    `avatar_original_name` VARCHAR(255) NULL,
    `avatar_stored_name` VARCHAR(255) NULL,
    `avatar_mime_type` VARCHAR(64) NULL,
    `avatar_size_bytes` INTEGER NULL,
    `join_mode` ENUM('approval', 'invite_only') NOT NULL DEFAULT 'approval',
    `member_limit` INTEGER NOT NULL DEFAULT 100,
    `temporary` BOOLEAN NOT NULL DEFAULT false,
    `expires_at` DATETIME(3) NULL,
    `status` ENUM('active', 'dissolved') NOT NULL DEFAULT 'active',
    `dissolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `chat_groups_conversation_id_key`(`conversation_id`),
    UNIQUE INDEX `chat_groups_avatar_stored_name_key`(`avatar_stored_name`),
    INDEX `chat_groups_owner_id_status_idx`(`owner_id`, `status`),
    INDEX `chat_groups_status_expires_at_idx`(`status`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `chat_group_members` (
    `group_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `role` ENUM('owner', 'admin', 'member') NOT NULL DEFAULT 'member',
    `status` ENUM('active', 'left', 'removed', 'blocked') NOT NULL DEFAULT 'active',
    `alias` VARCHAR(32) NULL,
    `muted_until` DATETIME(3) NULL,
    `joined_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `left_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `chat_group_members_user_id_status_updated_at_idx`(`user_id`, `status`, `updated_at`),
    INDEX `chat_group_members_group_id_role_status_idx`(`group_id`, `role`, `status`),
    PRIMARY KEY (`group_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `chat_group_invitations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `group_id` INTEGER NOT NULL,
    `inviter_id` INTEGER NOT NULL,
    `invitee_id` INTEGER NOT NULL,
    `status` ENUM('pending', 'accepted', 'declined', 'cancelled', 'expired') NOT NULL DEFAULT 'pending',
    `expires_at` DATETIME(3) NOT NULL,
    `responded_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `chat_group_invitations_invitee_id_status_expires_at_idx`(`invitee_id`, `status`, `expires_at`),
    INDEX `chat_group_invitations_group_id_status_idx`(`group_id`, `status`),
    INDEX `chat_group_invitations_inviter_id_idx`(`inviter_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `chat_group_join_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `group_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `note` VARCHAR(120) NULL,
    `status` ENUM('pending', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
    `handled_by_id` INTEGER NULL,
    `responded_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `chat_group_join_requests_group_id_status_created_at_idx`(`group_id`, `status`, `created_at`),
    INDEX `chat_group_join_requests_user_id_status_created_at_idx`(`user_id`, `status`, `created_at`),
    INDEX `chat_group_join_requests_handled_by_id_idx`(`handled_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `chat_group_message_reports` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `group_id` INTEGER NOT NULL,
    `message_id` INTEGER NOT NULL,
    `reporter_id` INTEGER NOT NULL,
    `reason` VARCHAR(40) NOT NULL,
    `detail` VARCHAR(300) NULL,
    `status` ENUM('pending', 'resolved', 'rejected') NOT NULL DEFAULT 'pending',
    `handled_by_id` INTEGER NULL,
    `resolution` VARCHAR(300) NULL,
    `handled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `chat_group_message_reports_message_id_reporter_id_key`(`message_id`, `reporter_id`),
    INDEX `chat_group_message_reports_status_created_at_idx`(`status`, `created_at`),
    INDEX `chat_group_message_reports_group_id_status_created_at_idx`(`group_id`, `status`, `created_at`),
    INDEX `chat_group_message_reports_reporter_id_idx`(`reporter_id`),
    INDEX `chat_group_message_reports_handled_by_id_idx`(`handled_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `chat_group_activity_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `group_id` INTEGER NOT NULL,
    `actor_id` INTEGER NULL,
    `target_user_id` INTEGER NULL,
    `action` VARCHAR(60) NOT NULL,
    `summary` VARCHAR(255) NOT NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `chat_group_activity_logs_group_id_created_at_idx`(`group_id`, `created_at`),
    INDEX `chat_group_activity_logs_actor_id_created_at_idx`(`actor_id`, `created_at`),
    INDEX `chat_group_activity_logs_target_user_id_idx`(`target_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `chat_groups` ADD CONSTRAINT `chat_groups_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_groups` ADD CONSTRAINT `chat_groups_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `chat_group_members` ADD CONSTRAINT `chat_group_members_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `chat_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_group_members` ADD CONSTRAINT `chat_group_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_group_invitations` ADD CONSTRAINT `chat_group_invitations_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `chat_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_group_invitations` ADD CONSTRAINT `chat_group_invitations_inviter_id_fkey` FOREIGN KEY (`inviter_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_group_invitations` ADD CONSTRAINT `chat_group_invitations_invitee_id_fkey` FOREIGN KEY (`invitee_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_group_join_requests` ADD CONSTRAINT `chat_group_join_requests_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `chat_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_group_join_requests` ADD CONSTRAINT `chat_group_join_requests_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_group_join_requests` ADD CONSTRAINT `chat_group_join_requests_handled_by_id_fkey` FOREIGN KEY (`handled_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `chat_group_message_reports` ADD CONSTRAINT `chat_group_message_reports_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `chat_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_group_message_reports` ADD CONSTRAINT `chat_group_message_reports_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_group_message_reports` ADD CONSTRAINT `chat_group_message_reports_reporter_id_fkey` FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_group_message_reports` ADD CONSTRAINT `chat_group_message_reports_handled_by_id_fkey` FOREIGN KEY (`handled_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `chat_group_activity_logs` ADD CONSTRAINT `chat_group_activity_logs_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `chat_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_group_activity_logs` ADD CONSTRAINT `chat_group_activity_logs_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `chat_group_activity_logs` ADD CONSTRAINT `chat_group_activity_logs_target_user_id_fkey` FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
