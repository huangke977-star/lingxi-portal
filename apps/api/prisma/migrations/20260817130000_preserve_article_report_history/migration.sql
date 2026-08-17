ALTER TABLE `articles`
  ADD COLUMN IF NOT EXISTS `publication_count` INTEGER NOT NULL DEFAULT 0;

UPDATE `articles`
SET `publication_count` = 1
WHERE `published_at` IS NOT NULL;

ALTER TABLE `article_reports`
  ADD COLUMN IF NOT EXISTS `publication_number` INTEGER NOT NULL DEFAULT 1;

CREATE INDEX `article_reports_article_publication_reason_status_idx`
  ON `article_reports`(`article_id`, `publication_number`, `reason`, `status`);

DROP INDEX `article_reports_article_id_reporter_id_key` ON `article_reports`;

CREATE INDEX `article_reports_article_id_reporter_id_idx`
  ON `article_reports`(`article_id`, `reporter_id`);
