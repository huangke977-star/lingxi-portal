-- AlterTable
ALTER TABLE `chat_messages`
    MODIFY `type` ENUM('text', 'attachment', 'mixed', 'system') NOT NULL DEFAULT 'text';

-- AlterTable
ALTER TABLE `user_notifications`
    MODIFY `type` ENUM(
        'friend_request_received',
        'friend_request_accepted',
        'friend_request_declined',
        'comment_report_resolved',
        'comment_report_rejected',
        'comment_author_moderated',
        'system'
    ) NOT NULL;
