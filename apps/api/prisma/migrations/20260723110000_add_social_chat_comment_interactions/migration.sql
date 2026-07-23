-- AlterTable
ALTER TABLE `article_comments`
    ADD COLUMN `like_count` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `article_comment_likes` (
    `comment_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `article_comment_likes_user_id_idx`(`user_id`),
    PRIMARY KEY (`comment_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `article_comment_reports` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `comment_id` INTEGER NOT NULL,
    `reporter_id` INTEGER NOT NULL,
    `reason` ENUM('spam', 'harassment', 'illegal', 'privacy', 'misinformation', 'other') NOT NULL,
    `detail` VARCHAR(500) NULL,
    `status` ENUM('pending', 'resolved', 'rejected') NOT NULL DEFAULT 'pending',
    `handled_by_id` INTEGER NULL,
    `handled_at` DATETIME(3) NULL,
    `resolution` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `article_comment_reports_comment_id_reporter_id_key`(`comment_id`, `reporter_id`),
    INDEX `article_comment_reports_status_created_at_idx`(`status`, `created_at`),
    INDEX `article_comment_reports_reporter_id_idx`(`reporter_id`),
    INDEX `article_comment_reports_handled_by_id_idx`(`handled_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `friendships` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_one_id` INTEGER NOT NULL,
    `user_two_id` INTEGER NOT NULL,
    `requested_by_id` INTEGER NOT NULL,
    `status` ENUM('pending', 'accepted', 'declined', 'removed') NOT NULL DEFAULT 'pending',
    `responded_at` DATETIME(3) NULL,
    `accepted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `friendships_user_one_id_user_two_id_key`(`user_one_id`, `user_two_id`),
    INDEX `friendships_user_one_id_status_idx`(`user_one_id`, `status`),
    INDEX `friendships_user_two_id_status_idx`(`user_two_id`, `status`),
    INDEX `friendships_requested_by_id_idx`(`requested_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `friendship_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `conversations_friendship_id_key`(`friendship_id`),
    INDEX `conversations_updated_at_idx`(`updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversation_id` INTEGER NOT NULL,
    `sender_id` INTEGER NOT NULL,
    `body` TEXT NOT NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `chat_messages_conversation_id_id_idx`(`conversation_id`, `id`),
    INDEX `chat_messages_sender_id_created_at_idx`(`sender_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `article_comment_likes` ADD CONSTRAINT `article_comment_likes_comment_id_fkey` FOREIGN KEY (`comment_id`) REFERENCES `article_comments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `article_comment_likes` ADD CONSTRAINT `article_comment_likes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `article_comment_reports` ADD CONSTRAINT `article_comment_reports_comment_id_fkey` FOREIGN KEY (`comment_id`) REFERENCES `article_comments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `article_comment_reports` ADD CONSTRAINT `article_comment_reports_reporter_id_fkey` FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `article_comment_reports` ADD CONSTRAINT `article_comment_reports_handled_by_id_fkey` FOREIGN KEY (`handled_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `friendships` ADD CONSTRAINT `friendships_user_one_id_fkey` FOREIGN KEY (`user_one_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `friendships` ADD CONSTRAINT `friendships_user_two_id_fkey` FOREIGN KEY (`user_two_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `friendships` ADD CONSTRAINT `friendships_requested_by_id_fkey` FOREIGN KEY (`requested_by_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_friendship_id_fkey` FOREIGN KEY (`friendship_id`) REFERENCES `friendships`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_sender_id_fkey` FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
