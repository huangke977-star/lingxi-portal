ALTER TABLE `chat_groups`
    ADD COLUMN `members_can_invite` BOOLEAN NOT NULL DEFAULT false AFTER `join_mode`;
