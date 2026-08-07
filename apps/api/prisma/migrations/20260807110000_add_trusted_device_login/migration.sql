ALTER TABLE `security_configurations`
  ADD COLUMN `untrusted_device_email_verification_enabled` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `known_login_devices`
  ADD COLUMN `trusted_at` DATETIME(3) NULL;

ALTER TABLE `email_verification_requests`
  MODIFY COLUMN `purpose` ENUM('registration', 'account_email', 'device_login') NOT NULL,
  ADD COLUMN `challenge_token_hash` CHAR(64) NULL,
  ADD COLUMN `device_fingerprint` CHAR(64) NULL;

CREATE UNIQUE INDEX `email_verification_requests_challenge_token_hash_key`
  ON `email_verification_requests`(`challenge_token_hash`);

ALTER TABLE `mail_jobs`
  MODIFY COLUMN `type` ENUM(
    'registration_verification',
    'account_email_verification',
    'device_login_verification',
    'password_reset',
    'login_risk',
    'security_notice'
  ) NOT NULL;
