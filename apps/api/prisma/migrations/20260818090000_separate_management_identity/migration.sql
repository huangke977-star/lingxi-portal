ALTER TABLE `users`
  ADD COLUMN `is_administrator` BOOLEAN NOT NULL DEFAULT false AFTER `is_super_admin`;

UPDATE `users` AS `user`
INNER JOIN `roles` AS `current_role` ON `current_role`.`id` = `user`.`role_id`
SET `user`.`is_administrator` = CASE WHEN `user`.`is_super_admin` = true THEN false ELSE true END
WHERE `current_role`.`code` = 'administrator';

UPDATE `users` AS `user`
INNER JOIN `roles` AS `current_role` ON `current_role`.`id` = `user`.`role_id`
INNER JOIN `roles` AS `growth_role` ON `growth_role`.`code` = CASE
  WHEN `user`.`experience` >= 20000 THEN 'mahayana'
  WHEN `user`.`experience` >= 10000 THEN 'body_integration'
  WHEN `user`.`experience` >= 5000 THEN 'void_refining'
  WHEN `user`.`experience` >= 2000 THEN 'spirit_transformation'
  WHEN `user`.`experience` >= 1000 THEN 'nascent_soul'
  WHEN `user`.`experience` >= 500 THEN 'golden_core'
  WHEN `user`.`experience` >= 200 THEN 'foundation_building'
  ELSE 'qi_refining'
END
SET `user`.`role_id` = `growth_role`.`id`
WHERE `current_role`.`code` = 'administrator';

UPDATE `site_settings`
SET `default_role_code` = 'qi_refining'
WHERE `default_role_code` = 'administrator';

DELETE FROM `roles` WHERE `code` = 'administrator';
