UPDATE `site_settings`
SET `default_background_url` = '/images/hlovet-city-lights.jpg'
WHERE `default_background_url` = '/images/hlovet-cloud-blue.jpeg';

ALTER TABLE `site_settings`
  MODIFY COLUMN `default_background_url` VARCHAR(512) NOT NULL DEFAULT '/images/hlovet-city-lights.jpg';
