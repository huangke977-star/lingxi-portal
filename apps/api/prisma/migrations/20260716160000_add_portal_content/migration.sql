CREATE TABLE `portal_categories` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `kind` ENUM('navigation', 'tool', 'server', 'custom_page') NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `slug` VARCHAR(80) NOT NULL,
  `description` VARCHAR(255) NOT NULL DEFAULT '',
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  `created_by_id` INTEGER NULL,
  `updated_by_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `portal_categories_slug_key`(`slug`),
  INDEX `portal_categories_kind_status_sort_order_idx`(`kind`, `status`, `sort_order`),
  INDEX `portal_categories_created_by_id_idx`(`created_by_id`),
  INDEX `portal_categories_updated_by_id_idx`(`updated_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `portal_entries` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `category_id` INTEGER NOT NULL,
  `title` VARCHAR(100) NOT NULL,
  `description` VARCHAR(300) NOT NULL DEFAULT '',
  `url` VARCHAR(2048) NULL,
  `icon_path` VARCHAR(512) NULL,
  `open_in_new_tab` BOOLEAN NOT NULL DEFAULT true,
  `visibility` ENUM('public', 'authenticated', 'role_restricted') NOT NULL DEFAULT 'public',
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  `created_by_id` INTEGER NULL,
  `updated_by_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `portal_entries_category_id_status_sort_order_idx`(`category_id`, `status`, `sort_order`),
  INDEX `portal_entries_visibility_idx`(`visibility`),
  INDEX `portal_entries_created_by_id_idx`(`created_by_id`),
  INDEX `portal_entries_updated_by_id_idx`(`updated_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `portal_entry_roles` (
  `entry_id` INTEGER NOT NULL,
  `role_id` INTEGER NOT NULL,

  INDEX `portal_entry_roles_role_id_idx`(`role_id`),
  PRIMARY KEY (`entry_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `portal_categories` ADD CONSTRAINT `portal_categories_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `portal_categories` ADD CONSTRAINT `portal_categories_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `portal_entries` ADD CONSTRAINT `portal_entries_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `portal_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `portal_entries` ADD CONSTRAINT `portal_entries_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `portal_entries` ADD CONSTRAINT `portal_entries_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `portal_entry_roles` ADD CONSTRAINT `portal_entry_roles_entry_id_fkey` FOREIGN KEY (`entry_id`) REFERENCES `portal_entries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `portal_entry_roles` ADD CONSTRAINT `portal_entry_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO `portal_categories` (`kind`, `name`, `slug`, `description`, `sort_order`, `status`, `updated_at`) VALUES
  ('navigation', '常用入口', 'public-navigation', '公开项目与设计参考', 10, 'active', CURRENT_TIMESTAMP(3)),
  ('tool', '常用工具', 'common-tools', '登录后可用的工具与检查入口', 20, 'active', CURRENT_TIMESTAMP(3)),
  ('server', '服务器入口', 'server-entries', '仅超级管理员可见的内部服务入口', 30, 'active', CURRENT_TIMESTAMP(3));

INSERT INTO `portal_entries` (`category_id`, `title`, `description`, `url`, `icon_path`, `open_in_new_tab`, `visibility`, `sort_order`, `status`, `updated_at`)
SELECT `id`, '项目仓库', 'HLOVET 的代码仓库和版本记录。', 'https://github.com/huangke977-star/lingxi-portal', NULL, true, 'public', 10, 'active', CURRENT_TIMESTAMP(3)
FROM `portal_categories` WHERE `slug` = 'public-navigation';

INSERT INTO `portal_entries` (`category_id`, `title`, `description`, `url`, `icon_path`, `open_in_new_tab`, `visibility`, `sort_order`, `status`, `updated_at`)
SELECT `id`, 'shadcn/ui', '后续组件体系和界面细节的重要参考。', 'https://ui.shadcn.com/', NULL, true, 'public', 20, 'active', CURRENT_TIMESTAMP(3)
FROM `portal_categories` WHERE `slug` = 'public-navigation';

INSERT INTO `portal_entries` (`category_id`, `title`, `description`, `url`, `icon_path`, `open_in_new_tab`, `visibility`, `sort_order`, `status`, `updated_at`)
SELECT `id`, 'Homepage', '导航、服务入口和状态面板的信息组织参考。', 'https://gethomepage.dev/', NULL, true, 'public', 30, 'active', CURRENT_TIMESTAMP(3)
FROM `portal_categories` WHERE `slug` = 'public-navigation';

INSERT INTO `portal_entries` (`category_id`, `title`, `description`, `url`, `icon_path`, `open_in_new_tab`, `visibility`, `sort_order`, `status`, `updated_at`)
SELECT `id`, 'JSON 工具', '格式化、校验和压缩接口数据。', NULL, NULL, false, 'authenticated', 10, 'active', CURRENT_TIMESTAMP(3)
FROM `portal_categories` WHERE `slug` = 'common-tools';

INSERT INTO `portal_entries` (`category_id`, `title`, `description`, `url`, `icon_path`, `open_in_new_tab`, `visibility`, `sort_order`, `status`, `updated_at`)
SELECT `id`, '域名检查', '记录域名解析、证书和可用性检查入口。', NULL, NULL, false, 'authenticated', 20, 'active', CURRENT_TIMESTAMP(3)
FROM `portal_categories` WHERE `slug` = 'common-tools';

INSERT INTO `portal_entries` (`category_id`, `title`, `description`, `url`, `icon_path`, `open_in_new_tab`, `visibility`, `sort_order`, `status`, `updated_at`)
SELECT `id`, '服务器入口', '记录服务器面板、监控和内部入口。', NULL, NULL, false, 'authenticated', 10, 'active', CURRENT_TIMESTAMP(3)
FROM `portal_categories` WHERE `slug` = 'server-entries';
