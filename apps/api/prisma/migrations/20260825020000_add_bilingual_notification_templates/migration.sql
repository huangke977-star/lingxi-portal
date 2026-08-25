ALTER TABLE `site_settings`
  ADD COLUMN `template_article_liked_en` VARCHAR(240) NOT NULL DEFAULT '{actor} liked {article}.',
  ADD COLUMN `template_article_favorited_en` VARCHAR(240) NOT NULL DEFAULT '{actor} favorited {article}.',
  ADD COLUMN `template_article_commented_en` VARCHAR(240) NOT NULL DEFAULT '{actor} commented on {article}.',
  ADD COLUMN `template_comment_replied_en` VARCHAR(240) NOT NULL DEFAULT '{actor} replied to your comment on {article}.',
  ADD COLUMN `template_author_subscribed_en` VARCHAR(240) NOT NULL DEFAULT '{actor} subscribed to you.',
  ADD COLUMN `template_subscription_published_en` VARCHAR(240) NOT NULL DEFAULT '{author} published {article}.',
  ADD COLUMN `template_friend_request_en` VARCHAR(240) NOT NULL DEFAULT '{actor} sent you a friend request.',
  ADD COLUMN `template_comment_report_handled_en` VARCHAR(240) NOT NULL DEFAULT 'Your report of a comment on {article} was {result}.',
  ADD COLUMN `template_comment_author_moderated_en` VARCHAR(240) NOT NULL DEFAULT 'Your comment on {article} was {result}.';

ALTER TABLE `user_notifications`
  ADD COLUMN `body_en` VARCHAR(500) NULL;
