ALTER TABLE `anonymous_topics`
  ADD COLUMN `message_sequence` INTEGER NOT NULL DEFAULT 0 AFTER `message_count`;

UPDATE `anonymous_topics` AS topic
LEFT JOIN (
  SELECT
    `topic_id`,
    COALESCE(MAX(`sequence`), 0) AS `message_sequence`,
    SUM(CASE WHEN `is_hidden` = false THEN 1 ELSE 0 END) AS `visible_message_count`
  FROM `anonymous_topic_messages`
  GROUP BY `topic_id`
) AS totals ON totals.`topic_id` = topic.`id`
SET
  topic.`message_sequence` = COALESCE(totals.`message_sequence`, 0),
  topic.`message_count` = COALESCE(totals.`visible_message_count`, 0);
