ALTER TABLE `daily_operation_metrics`
  ADD COLUMN `notifications` INT NOT NULL DEFAULT 0,
  ADD COLUMN `notification_reads` INT NOT NULL DEFAULT 0,
  ADD COLUMN `notification_opens` INT NOT NULL DEFAULT 0;
