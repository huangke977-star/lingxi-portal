CREATE TABLE `articles` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `author_id` INTEGER NOT NULL,
  `title` VARCHAR(120) NOT NULL,
  `slug` VARCHAR(180) NOT NULL,
  `summary` VARCHAR(300) NOT NULL DEFAULT '',
  `content` LONGTEXT NOT NULL,
  `cover_path` VARCHAR(512) NULL,
  `category` VARCHAR(80) NOT NULL DEFAULT '',
  `tags` VARCHAR(500) NOT NULL DEFAULT '',
  `title_color` VARCHAR(7) NOT NULL DEFAULT '',
  `visibility` ENUM('public', 'authenticated', 'role_restricted', 'private') NOT NULL DEFAULT 'public',
  `status` ENUM('draft', 'published', 'unpublished', 'blocked', 'deleted') NOT NULL DEFAULT 'draft',
  `is_pinned` BOOLEAN NOT NULL DEFAULT false,
  `pin_order` INTEGER NOT NULL DEFAULT 0,
  `published_at` DATETIME(3) NULL,
  `blocked_reason` VARCHAR(255) NULL,
  `view_count` INTEGER NOT NULL DEFAULT 0,
  `like_count` INTEGER NOT NULL DEFAULT 0,
  `favorite_count` INTEGER NOT NULL DEFAULT 0,
  `comment_count` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `articles_slug_key`(`slug`),
  INDEX `articles_author_id_status_updated_at_idx`(`author_id`, `status`, `updated_at`),
  INDEX `articles_status_visibility_is_pinned_pin_order_idx`(`status`, `visibility`, `is_pinned`, `pin_order`),
  INDEX `articles_category_status_idx`(`category`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `article_allowed_roles` (
  `article_id` INTEGER NOT NULL,
  `role_id` INTEGER NOT NULL,

  INDEX `article_allowed_roles_role_id_idx`(`role_id`),
  PRIMARY KEY (`article_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `article_images` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `article_id` INTEGER NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `stored_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(64) NOT NULL,
  `size_bytes` INTEGER NOT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `article_images_stored_name_key`(`stored_name`),
  INDEX `article_images_article_id_sort_order_idx`(`article_id`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `article_comments` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `article_id` INTEGER NOT NULL,
  `author_id` INTEGER NOT NULL,
  `parent_id` INTEGER NULL,
  `body` TEXT NOT NULL,
  `status` ENUM('active', 'blocked', 'deleted') NOT NULL DEFAULT 'active',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `article_comments_article_id_status_created_at_idx`(`article_id`, `status`, `created_at`),
  INDEX `article_comments_parent_id_idx`(`parent_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `article_likes` (
  `article_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `article_likes_user_id_idx`(`user_id`),
  PRIMARY KEY (`article_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `article_favorites` (
  `article_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `article_favorites_user_id_idx`(`user_id`),
  PRIMARY KEY (`article_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `article_views` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `article_id` INTEGER NOT NULL,
  `user_id` INTEGER NULL,
  `visitor_key` VARCHAR(191) NOT NULL,
  `viewed_on` VARCHAR(10) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `article_views_article_id_visitor_key_viewed_on_key`(`article_id`, `visitor_key`, `viewed_on`),
  INDEX `article_views_article_id_created_at_idx`(`article_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `articles` ADD CONSTRAINT `articles_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `article_allowed_roles` ADD CONSTRAINT `article_allowed_roles_article_id_fkey` FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `article_allowed_roles` ADD CONSTRAINT `article_allowed_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `article_images` ADD CONSTRAINT `article_images_article_id_fkey` FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `article_comments` ADD CONSTRAINT `article_comments_article_id_fkey` FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `article_comments` ADD CONSTRAINT `article_comments_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `article_comments` ADD CONSTRAINT `article_comments_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `article_comments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `article_likes` ADD CONSTRAINT `article_likes_article_id_fkey` FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `article_likes` ADD CONSTRAINT `article_likes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `article_favorites` ADD CONSTRAINT `article_favorites_article_id_fkey` FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `article_favorites` ADD CONSTRAINT `article_favorites_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `article_views` ADD CONSTRAINT `article_views_article_id_fkey` FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `article_views` ADD CONSTRAINT `article_views_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
