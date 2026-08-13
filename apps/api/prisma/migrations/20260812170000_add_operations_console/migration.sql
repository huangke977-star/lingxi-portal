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
        'announcement_published',
        'system'
    ) NOT NULL,
    ADD COLUMN `announcement_id` INTEGER NULL,
    ADD COLUMN `dedupe_key` VARCHAR(160) NULL;

CREATE UNIQUE INDEX `user_notifications_dedupe_key_key`
    ON `user_notifications`(`dedupe_key`);

CREATE TABLE `daily_operation_metrics` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `metric_date` DATE NOT NULL,
    `new_users` INTEGER NOT NULL DEFAULT 0,
    `active_users` INTEGER NOT NULL DEFAULT 0,
    `published_articles` INTEGER NOT NULL DEFAULT 0,
    `comments` INTEGER NOT NULL DEFAULT 0,
    `messages` INTEGER NOT NULL DEFAULT 0,
    `article_views` INTEGER NOT NULL DEFAULT 0,
    `likes` INTEGER NOT NULL DEFAULT 0,
    `favorites` INTEGER NOT NULL DEFAULT 0,
    `subscriptions` INTEGER NOT NULL DEFAULT 0,
    `article_reports` INTEGER NOT NULL DEFAULT 0,
    `group_reports` INTEGER NOT NULL DEFAULT 0,
    `disabled_users` INTEGER NOT NULL DEFAULT 0,
    `login_risks` INTEGER NOT NULL DEFAULT 0,
    `failed_jobs` INTEGER NOT NULL DEFAULT 0,
    `generated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `daily_operation_metrics_metric_date_key`(`metric_date`),
    INDEX `daily_operation_metrics_metric_date_idx`(`metric_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `daily_operation_rankings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `metric_date` DATE NOT NULL,
    `category` VARCHAR(32) NOT NULL,
    `entity_key` VARCHAR(120) NOT NULL,
    `label` VARCHAR(160) NOT NULL,
    `secondary` VARCHAR(200) NOT NULL DEFAULT '',
    `score` INTEGER NOT NULL DEFAULT 0,
    `metadata` JSON NULL,
    `generated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `daily_operation_rankings_metric_date_category_entity_key_key`(`metric_date`, `category`, `entity_key`),
    INDEX `daily_operation_rankings_category_metric_date_score_idx`(`category`, `metric_date`, `score`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `operation_job_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `job_type` VARCHAR(48) NOT NULL,
    `status` ENUM('running', 'completed', 'failed') NOT NULL DEFAULT 'running',
    `detail` VARCHAR(255) NOT NULL DEFAULT '',
    `error` VARCHAR(1000) NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `operation_job_runs_job_type_status_created_at_idx`(`job_type`, `status`, `created_at`),
    INDEX `operation_job_runs_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `announcements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(120) NOT NULL,
    `summary` VARCHAR(300) NOT NULL DEFAULT '',
    `content` TEXT NOT NULL,
    `audience` ENUM('public', 'authenticated', 'role_restricted') NOT NULL DEFAULT 'public',
    `status` ENUM('draft', 'scheduled', 'published', 'expired', 'archived') NOT NULL DEFAULT 'draft',
    `is_pinned` BOOLEAN NOT NULL DEFAULT false,
    `pin_order` INTEGER NOT NULL DEFAULT 0,
    `push_enabled` BOOLEAN NOT NULL DEFAULT true,
    `scheduled_at` DATETIME(3) NULL,
    `published_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `delivery_started_at` DATETIME(3) NULL,
    `delivered_at` DATETIME(3) NULL,
    `delivery_attempts` INTEGER NOT NULL DEFAULT 0,
    `delivery_error` VARCHAR(1000) NULL,
    `recipient_count` INTEGER NOT NULL DEFAULT 0,
    `view_count` INTEGER NOT NULL DEFAULT 0,
    `created_by_id` INTEGER NOT NULL,
    `updated_by_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `announcements_status_published_at_idx`(`status`, `published_at`),
    INDEX `announcements_audience_status_is_pinned_pin_order_idx`(`audience`, `status`, `is_pinned`, `pin_order`),
    INDEX `announcements_scheduled_at_status_idx`(`scheduled_at`, `status`),
    INDEX `announcements_expires_at_status_idx`(`expires_at`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `announcement_allowed_roles` (
    `announcement_id` INTEGER NOT NULL,
    `role_id` INTEGER NOT NULL,

    INDEX `announcement_allowed_roles_role_id_idx`(`role_id`),
    PRIMARY KEY (`announcement_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `announcement_reads` (
    `announcement_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `view_count` INTEGER NOT NULL DEFAULT 1,
    `first_viewed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_viewed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `confirmed_at` DATETIME(3) NULL,

    INDEX `announcement_reads_user_id_confirmed_at_last_viewed_at_idx`(`user_id`, `confirmed_at`, `last_viewed_at`),
    PRIMARY KEY (`announcement_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `user_notifications_user_id_announcement_id_key`
    ON `user_notifications`(`user_id`, `announcement_id`);

ALTER TABLE `announcements`
    ADD CONSTRAINT `announcements_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `announcements_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `announcement_allowed_roles`
    ADD CONSTRAINT `announcement_allowed_roles_announcement_id_fkey` FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `announcement_allowed_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `announcement_reads`
    ADD CONSTRAINT `announcement_reads_announcement_id_fkey` FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `announcement_reads_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `user_notifications`
    ADD CONSTRAINT `user_notifications_announcement_id_fkey` FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
