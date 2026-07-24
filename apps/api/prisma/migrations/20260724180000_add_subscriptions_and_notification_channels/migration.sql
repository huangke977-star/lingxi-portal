-- AlterTable
ALTER TABLE `user_notifications`
    MODIFY `type` ENUM(
        'friend_request_received',
        'friend_request_accepted',
        'friend_request_declined',
        'comment_report_resolved',
        'comment_report_rejected',
        'comment_author_moderated',
        'article_liked',
        'article_favorited',
        'article_commented',
        'comment_replied',
        'author_subscribed',
        'subscription_published',
        'system'
    ) NOT NULL,
    ADD COLUMN `channel` ENUM('system', 'subscription', 'interaction') NOT NULL DEFAULT 'system',
    ADD COLUMN `article_id` INTEGER NULL,
    ADD COLUMN `comment_id` INTEGER NULL,
    ADD COLUMN `aggregate_count` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);

-- CreateTable
CREATE TABLE `user_subscriptions` (
    `subscriber_id` INTEGER NOT NULL,
    `author_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`subscriber_id`, `author_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `user_subscriptions_author_id_created_at_idx` ON `user_subscriptions`(`author_id`, `created_at`);
CREATE INDEX `user_notifications_user_id_channel_read_at_id_idx` ON `user_notifications`(`user_id`, `channel`, `read_at`, `id`);
CREATE INDEX `user_notifications_user_id_type_article_id_read_at_idx` ON `user_notifications`(`user_id`, `type`, `article_id`, `read_at`);
CREATE INDEX `user_notifications_article_id_idx` ON `user_notifications`(`article_id`);
CREATE INDEX `user_notifications_comment_id_idx` ON `user_notifications`(`comment_id`);

-- DropIndex
DROP INDEX `user_notifications_user_id_read_at_id_idx` ON `user_notifications`;

-- AddForeignKey
ALTER TABLE `user_subscriptions`
    ADD CONSTRAINT `user_subscriptions_subscriber_id_fkey`
    FOREIGN KEY (`subscriber_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `user_subscriptions`
    ADD CONSTRAINT `user_subscriptions_author_id_fkey`
    FOREIGN KEY (`author_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `user_notifications`
    ADD CONSTRAINT `user_notifications_article_id_fkey`
    FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `user_notifications`
    ADD CONSTRAINT `user_notifications_comment_id_fkey`
    FOREIGN KEY (`comment_id`) REFERENCES `article_comments`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
