ALTER TABLE `security_configurations`
  ADD COLUMN `google_oauth_managed` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `google_oauth_enabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `google_oauth_client_id` VARCHAR(255) NULL,
  ADD COLUMN `google_oauth_client_secret_encrypted` TEXT NULL,
  ADD COLUMN `google_oauth_redirect_uri` VARCHAR(512) NULL;
