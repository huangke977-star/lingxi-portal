ALTER TABLE `announcements`
    ADD COLUMN `publish_mode` ENUM('immediate', 'scheduled') NOT NULL DEFAULT 'immediate' AFTER `status`;

UPDATE `announcements`
SET `publish_mode` = 'scheduled'
WHERE `status` = 'scheduled';
