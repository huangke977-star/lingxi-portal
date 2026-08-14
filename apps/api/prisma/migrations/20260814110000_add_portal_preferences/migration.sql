ALTER TABLE `portal_entries`
  ADD COLUMN `is_featured` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `featured_sort_order` INTEGER NOT NULL DEFAULT 0;

CREATE INDEX `portal_entries_is_featured_featured_sort_order_idx`
  ON `portal_entries`(`is_featured`, `featured_sort_order`);

CREATE TABLE `user_portal_preferences` (
  `user_id` INTEGER NOT NULL,
  `home_entry_ids` JSON NOT NULL,
  `tool_entry_ids` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  PRIMARY KEY (`user_id`),
  CONSTRAINT `user_portal_preferences_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
);
