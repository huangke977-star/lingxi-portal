ALTER TABLE `daily_operation_metrics`
  ADD COLUMN `onboarding_completed` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `resource_exchanges` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `resource_points_spent` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `resource_points_pending` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `resource_points_settled` INTEGER NOT NULL DEFAULT 0;
