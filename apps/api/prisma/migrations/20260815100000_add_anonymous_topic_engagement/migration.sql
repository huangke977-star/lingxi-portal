ALTER TABLE `anonymous_topics`
  ADD COLUMN `message_like_count` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `favorite_count` INTEGER NOT NULL DEFAULT 0;

UPDATE `anonymous_topics` AS topic
LEFT JOIN (
  SELECT `topic_id`, COALESCE(SUM(`like_count`), 0) AS `message_like_count`
  FROM `anonymous_topic_messages`
  WHERE `is_hidden` = false
  GROUP BY `topic_id`
) AS totals ON totals.`topic_id` = topic.`id`
SET topic.`message_like_count` = COALESCE(totals.`message_like_count`, 0);

CREATE INDEX `anonymous_topics_engagement_sort_idx`
  ON `anonymous_topics`(`is_hidden`, `favorite_count`, `message_count`, `message_like_count`, `updated_at`);

CREATE TABLE `anonymous_topic_favorites` (
  `topic_id` INTEGER NOT NULL,
  `visitor_key` CHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`topic_id`, `visitor_key`),
  INDEX `anonymous_topic_favorites_visitor_key_created_at_idx`(`visitor_key`, `created_at`),
  CONSTRAINT `anonymous_topic_favorites_topic_id_fkey`
    FOREIGN KEY (`topic_id`) REFERENCES `anonymous_topics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE `daily_operation_metrics`
  ADD COLUMN `anonymous_topics` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `anonymous_messages` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `anonymous_likes` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `anonymous_favorites` INTEGER NOT NULL DEFAULT 0;
