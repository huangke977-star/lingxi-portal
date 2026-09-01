ALTER TABLE `email_verification_requests`
  MODIFY `purpose` ENUM('registration', 'account_email', 'device_login', 'totp_disable', 'passkey_delete', 'sensitive_action') NOT NULL,
  ADD COLUMN `action` VARCHAR(64) NULL;

CREATE INDEX `evr_user_purpose_action_status_created_idx`
  ON `email_verification_requests`(`user_id`, `purpose`, `action`, `status`, `created_at`);
