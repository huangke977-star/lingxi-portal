-- Track whether an account has explicitly customized its appearance.
ALTER TABLE `users`
  ADD COLUMN `appearance_customized` BOOLEAN NOT NULL DEFAULT false;

UPDATE `users`
SET `appearance_customized` = true
WHERE `appearance_theme_id` <> 'sakura-mist'
   OR `custom_accent` <> '#db2777'
   OR `custom_surface` <> '#ffffff'
   OR `custom_foreground` <> '#2b2530'
   OR `custom_muted` <> '#665867'
   OR `card_alpha` <> 52
   OR `glass_blur` <> 22
   OR `glass_tint` <> '#fff3f6'
   OR `glass_tint_alpha` <> 72;

-- Apply the super administrator's current appearance to accounts that never customized it.
UPDATE `users`
SET `appearance_theme_id` = 'cloud-blue',
    `custom_accent` = '#1814f0',
    `custom_surface` = '#dfc8c8',
    `custom_foreground` = '#2b2530',
    `custom_muted` = '#665867',
    `card_alpha` = 50,
    `glass_blur` = 18,
    `glass_tint` = '#fff3f6',
    `glass_tint_alpha` = 0
WHERE `appearance_customized` = false;

ALTER TABLE `users`
  MODIFY `appearance_theme_id` VARCHAR(64) NOT NULL DEFAULT 'cloud-blue',
  MODIFY `custom_accent` VARCHAR(7) NOT NULL DEFAULT '#1814f0',
  MODIFY `custom_surface` VARCHAR(7) NOT NULL DEFAULT '#dfc8c8',
  MODIFY `custom_foreground` VARCHAR(7) NOT NULL DEFAULT '#2b2530',
  MODIFY `custom_muted` VARCHAR(7) NOT NULL DEFAULT '#665867',
  MODIFY `card_alpha` INTEGER NOT NULL DEFAULT 50,
  MODIFY `glass_blur` INTEGER NOT NULL DEFAULT 18,
  MODIFY `glass_tint` VARCHAR(7) NOT NULL DEFAULT '#fff3f6',
  MODIFY `glass_tint_alpha` INTEGER NOT NULL DEFAULT 0;

CREATE TABLE `user_notification_channel_states` (
  `user_id` INTEGER NOT NULL,
  `channel` ENUM('system', 'subscription', 'interaction') NOT NULL,
  `hidden_through_notification_id` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  PRIMARY KEY (`user_id`, `channel`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_notification_channel_states`
  ADD CONSTRAINT `user_notification_channel_states_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
