ALTER TABLE `article_templates`
  ADD COLUMN `title` VARCHAR(120) NOT NULL DEFAULT '' AFTER `name`;
