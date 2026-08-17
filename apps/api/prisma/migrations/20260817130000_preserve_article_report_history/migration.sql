SET @has_article_publication_count = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'articles'
    AND COLUMN_NAME = 'publication_count'
);
SET @add_article_publication_count = IF(
  @has_article_publication_count = 0,
  'ALTER TABLE `articles` ADD COLUMN `publication_count` INTEGER NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE add_article_publication_count FROM @add_article_publication_count;
EXECUTE add_article_publication_count;
DEALLOCATE PREPARE add_article_publication_count;

UPDATE `articles`
SET `publication_count` = 1
WHERE `published_at` IS NOT NULL;

SET @has_report_publication_number = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'article_reports'
    AND COLUMN_NAME = 'publication_number'
);
SET @add_report_publication_number = IF(
  @has_report_publication_number = 0,
  'ALTER TABLE `article_reports` ADD COLUMN `publication_number` INTEGER NOT NULL DEFAULT 1',
  'SELECT 1'
);
PREPARE add_report_publication_number FROM @add_report_publication_number;
EXECUTE add_report_publication_number;
DEALLOCATE PREPARE add_report_publication_number;

CREATE INDEX `article_reports_article_publication_reason_status_idx`
  ON `article_reports`(`article_id`, `publication_number`, `reason`, `status`);

DROP INDEX `article_reports_article_id_reporter_id_key` ON `article_reports`;

CREATE INDEX `article_reports_article_id_reporter_id_idx`
  ON `article_reports`(`article_id`, `reporter_id`);
