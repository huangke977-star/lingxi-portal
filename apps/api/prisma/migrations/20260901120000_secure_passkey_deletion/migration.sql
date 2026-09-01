ALTER TABLE `email_verification_requests`
  MODIFY `purpose` ENUM('registration', 'account_email', 'device_login', 'totp_disable', 'passkey_delete') NOT NULL,
  ADD COLUMN `target_id` INTEGER NULL;

CREATE INDEX `email_verification_requests_user_id_purpose_target_id_status_created_at_idx`
  ON `email_verification_requests`(`user_id`, `purpose`, `target_id`, `status`, `created_at`);
