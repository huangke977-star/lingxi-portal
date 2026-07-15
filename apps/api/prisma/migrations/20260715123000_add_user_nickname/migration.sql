ALTER TABLE `users`
  ADD COLUMN `nickname` VARCHAR(32) NULL AFTER `username`;

UPDATE `users`
SET `nickname` = `username`
WHERE `nickname` IS NULL OR CHAR_LENGTH(TRIM(`nickname`)) = 0;

ALTER TABLE `users`
  MODIFY `nickname` VARCHAR(32) NOT NULL;
