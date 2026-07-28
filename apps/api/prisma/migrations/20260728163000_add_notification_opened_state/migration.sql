ALTER TABLE `user_notifications`
  ADD COLUMN `opened_at` DATETIME(3) NULL;

UPDATE `user_notifications`
SET `opened_at` = `read_at`
WHERE `read_at` IS NOT NULL;
