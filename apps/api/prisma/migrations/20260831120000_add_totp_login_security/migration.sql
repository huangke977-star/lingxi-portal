ALTER TABLE `email_verification_requests`
  MODIFY `purpose` ENUM('registration', 'account_email', 'device_login', 'totp_disable') NOT NULL;
