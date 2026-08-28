CREATE TABLE `anonymous_topic_attachments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `message_id` INTEGER NOT NULL,
    `visitor_key` CHAR(64) NOT NULL,
    `kind` ENUM('image', 'file', 'audio', 'video') NOT NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `stored_name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(127) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `anonymous_topic_attachments_stored_name_key`(`stored_name`),
    INDEX `anonymous_topic_attachments_message_id_sort_order_idx`(`message_id`, `sort_order`),
    INDEX `anonymous_topic_attachments_visitor_key_created_at_idx`(`visitor_key`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `article_comment_attachments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `comment_id` INTEGER NOT NULL,
    `owner_id` INTEGER NOT NULL,
    `kind` ENUM('image', 'file', 'audio', 'video') NOT NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `stored_name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(127) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `article_comment_attachments_stored_name_key`(`stored_name`),
    INDEX `article_comment_attachments_comment_id_sort_order_idx`(`comment_id`, `sort_order`),
    INDEX `article_comment_attachments_owner_id_created_at_idx`(`owner_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `anonymous_topic_attachments`
    ADD CONSTRAINT `anonymous_topic_attachments_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `anonymous_topic_messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `article_comment_attachments`
    ADD CONSTRAINT `article_comment_attachments_comment_id_fkey` FOREIGN KEY (`comment_id`) REFERENCES `article_comments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `article_comment_attachments`
    ADD CONSTRAINT `article_comment_attachments_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
