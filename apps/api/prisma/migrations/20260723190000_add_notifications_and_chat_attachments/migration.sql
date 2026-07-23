-- AlterTable
ALTER TABLE `friendships`
    ADD COLUMN `request_note` VARCHAR(120) NULL;

-- AlterTable
ALTER TABLE `chat_messages`
    ADD COLUMN `type` ENUM('text', 'attachment', 'mixed') NOT NULL DEFAULT 'text';

-- CreateTable
CREATE TABLE `chat_attachments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversation_id` INTEGER NOT NULL,
    `uploaded_by_id` INTEGER NOT NULL,
    `message_id` INTEGER NULL,
    `kind` ENUM('image', 'file') NOT NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `stored_name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(127) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `chat_attachments_stored_name_key`(`stored_name`),
    INDEX `chat_attachments_conversation_id_message_id_idx`(`conversation_id`, `message_id`),
    INDEX `chat_attachments_uploaded_by_id_message_id_created_at_idx`(`uploaded_by_id`, `message_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_notifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `actor_id` INTEGER NULL,
    `type` ENUM('friend_request_received', 'friend_request_accepted', 'friend_request_declined', 'comment_report_resolved', 'comment_report_rejected', 'system') NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `body` VARCHAR(500) NOT NULL,
    `action_url` VARCHAR(512) NULL,
    `friendship_id` INTEGER NULL,
    `comment_report_id` INTEGER NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_notifications_user_id_read_at_id_idx`(`user_id`, `read_at`, `id`),
    INDEX `user_notifications_friendship_id_idx`(`friendship_id`),
    INDEX `user_notifications_comment_report_id_idx`(`comment_report_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `chat_attachments` ADD CONSTRAINT `chat_attachments_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_attachments` ADD CONSTRAINT `chat_attachments_uploaded_by_id_fkey` FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_attachments` ADD CONSTRAINT `chat_attachments_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `user_notifications` ADD CONSTRAINT `user_notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `user_notifications` ADD CONSTRAINT `user_notifications_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `user_notifications` ADD CONSTRAINT `user_notifications_friendship_id_fkey` FOREIGN KEY (`friendship_id`) REFERENCES `friendships`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `user_notifications` ADD CONSTRAINT `user_notifications_comment_report_id_fkey` FOREIGN KEY (`comment_report_id`) REFERENCES `article_comment_reports`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
