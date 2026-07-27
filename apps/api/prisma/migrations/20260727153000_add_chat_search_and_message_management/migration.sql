-- AlterTable
ALTER TABLE `chat_messages` ADD COLUMN `call_session_id` INTEGER NULL;

-- CreateTable
CREATE TABLE `conversation_participant_states` (
    `conversation_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `hidden` BOOLEAN NOT NULL DEFAULT false,
    `cleared_before_message_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `conversation_participant_states_user_id_hidden_updated_at_idx`(`user_id`, `hidden`, `updated_at`),
    PRIMARY KEY (`conversation_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_message_deletions` (
    `message_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `chat_message_deletions_user_id_message_id_idx`(`user_id`, `message_id`),
    PRIMARY KEY (`message_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill participant state for existing one-to-one conversations.
INSERT INTO `conversation_participant_states` (`conversation_id`, `user_id`, `hidden`, `created_at`, `updated_at`)
SELECT `c`.`id`, `f`.`user_one_id`, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `conversations` AS `c`
INNER JOIN `friendships` AS `f` ON `f`.`id` = `c`.`friendship_id`;

INSERT INTO `conversation_participant_states` (`conversation_id`, `user_id`, `hidden`, `created_at`, `updated_at`)
SELECT `c`.`id`, `f`.`user_two_id`, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `conversations` AS `c`
INNER JOIN `friendships` AS `f` ON `f`.`id` = `c`.`friendship_id`;

-- CreateIndex
CREATE UNIQUE INDEX `chat_messages_call_session_id_key` ON `chat_messages`(`call_session_id`);

-- AddForeignKey
ALTER TABLE `conversation_participant_states` ADD CONSTRAINT `conversation_participant_states_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `conversation_participant_states` ADD CONSTRAINT `conversation_participant_states_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_message_deletions` ADD CONSTRAINT `chat_message_deletions_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_message_deletions` ADD CONSTRAINT `chat_message_deletions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_call_session_id_fkey` FOREIGN KEY (`call_session_id`) REFERENCES `call_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
