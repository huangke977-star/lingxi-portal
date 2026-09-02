-- Add the notification type used by article-comment and chat @ mentions.
ALTER TABLE `user_notifications`
  MODIFY `type` ENUM(
    'friend_request_received',
    'friend_request_accepted',
    'friend_request_declined',
    'comment_report_resolved',
    'comment_report_rejected',
    'comment_author_moderated',
    'article_report_received',
    'article_report_resolved',
    'article_report_rejected',
    'article_author_moderated',
    'article_liked',
    'article_favorited',
    'article_commented',
    'comment_replied',
    'mention_received',
    'author_subscribed',
    'subscription_published',
    'announcement_published',
    'suggestion_updated',
    'article_appeal_received',
    'article_appeal_resolved',
    'feedback_updated',
    'article_publish_restricted',
    'article_scheduled_publish',
    'article_scheduled_publish_failed',
    'article_scheduled_unpublish',
    'system'
  ) NOT NULL;

-- MySQL non-strict mode stored unsupported mention values as an empty enum value.
UPDATE `user_notifications`
SET `type` = 'mention_received'
WHERE `type` = ''
  AND (
    `dedupe_key` LIKE 'mention:%'
    OR `comment_id` IS NOT NULL
    OR `message_id` IS NOT NULL
  );
