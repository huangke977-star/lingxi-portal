ALTER TABLE `articles`
  ADD COLUMN `content_format` ENUM('markdown', 'html') NOT NULL DEFAULT 'markdown' AFTER `content`;

ALTER TABLE `article_versions`
  ADD COLUMN `content_format` ENUM('markdown', 'html') NOT NULL DEFAULT 'markdown' AFTER `content`;

ALTER TABLE `article_templates`
  ADD COLUMN `content_format` ENUM('markdown', 'html') NOT NULL DEFAULT 'markdown' AFTER `content`;
