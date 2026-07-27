-- AlterTable
ALTER TABLE `chat_attachments`
    MODIFY `kind` ENUM('image', 'file', 'audio', 'video') NOT NULL;

-- CreateTable
CREATE TABLE `call_sessions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversation_id` INTEGER NOT NULL,
    `caller_id` INTEGER NOT NULL,
    `callee_id` INTEGER NOT NULL,
    `ended_by_id` INTEGER NULL,
    `type` ENUM('voice', 'video') NOT NULL,
    `status` ENUM('ringing', 'accepted', 'declined', 'busy', 'cancelled', 'missed', 'active', 'completed', 'failed') NOT NULL DEFAULT 'ringing',
    `accepted_at` DATETIME(3) NULL,
    `ended_at` DATETIME(3) NULL,
    `duration_seconds` INTEGER NULL,
    `failure_reason` VARCHAR(160) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `call_sessions_conversation_id_created_at_idx`(`conversation_id`, `created_at`),
    INDEX `call_sessions_caller_id_status_created_at_idx`(`caller_id`, `status`, `created_at`),
    INDEX `call_sessions_callee_id_status_created_at_idx`(`callee_id`, `status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `call_sessions` ADD CONSTRAINT `call_sessions_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `call_sessions` ADD CONSTRAINT `call_sessions_caller_id_fkey` FOREIGN KEY (`caller_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `call_sessions` ADD CONSTRAINT `call_sessions_callee_id_fkey` FOREIGN KEY (`callee_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `call_sessions` ADD CONSTRAINT `call_sessions_ended_by_id_fkey` FOREIGN KEY (`ended_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
