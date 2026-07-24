-- AlterTable
ALTER TABLE `friendships`
    MODIFY `status` ENUM('pending', 'accepted', 'declined', 'removed', 'blocked') NOT NULL DEFAULT 'pending',
    ADD COLUMN `blocked_by_id` INTEGER NULL;

-- CreateIndex
CREATE INDEX `friendships_blocked_by_id_idx` ON `friendships`(`blocked_by_id`);

-- AddForeignKey
ALTER TABLE `friendships`
    ADD CONSTRAINT `friendships_blocked_by_id_fkey`
    FOREIGN KEY (`blocked_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
