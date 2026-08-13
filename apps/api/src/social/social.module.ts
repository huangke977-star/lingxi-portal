import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RedisModule } from "../redis/redis.module";
import { SiteSettingsModule } from "../site-settings/site-settings.module";
import { UsersModule } from "../users/users.module";
import { ChatGateway } from "./chat.gateway";
import { ChatGroupAvatarsController, ChatGroupsController } from "./chat-groups.controller";
import { ChatGroupsService } from "./chat-groups.service";
import { ChatAttachmentsService } from "./chat-attachments.service";
import { CallsService } from "./calls.service";
import { SocialController } from "./social.controller";
import { SocialService } from "./social.service";
import { PublicProfilesController } from "./public-profiles.controller";
import { PushModule } from "../push/push.module";
import { PendingActionReminderService } from "./pending-action-reminder.service";

@Module({
  imports: [JwtModule.register({}), UsersModule, RedisModule, SiteSettingsModule, PushModule],
  controllers: [SocialController, PublicProfilesController, ChatGroupsController, ChatGroupAvatarsController],
  providers: [SocialService, ChatAttachmentsService, ChatGroupsService, CallsService, ChatGateway, PendingActionReminderService],
  exports: [SocialService, ChatGroupsService],
})
export class SocialModule {}
