import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RedisModule } from "../redis/redis.module";
import { SiteSettingsModule } from "../site-settings/site-settings.module";
import { UsersModule } from "../users/users.module";
import { ChatGateway } from "./chat.gateway";
import { ChatAttachmentsService } from "./chat-attachments.service";
import { CallsService } from "./calls.service";
import { SocialController } from "./social.controller";
import { SocialService } from "./social.service";
import { PublicProfilesController } from "./public-profiles.controller";
import { PushModule } from "../push/push.module";

@Module({
  imports: [JwtModule.register({}), UsersModule, RedisModule, SiteSettingsModule, PushModule],
  controllers: [SocialController, PublicProfilesController],
  providers: [SocialService, ChatAttachmentsService, CallsService, ChatGateway],
  exports: [SocialService],
})
export class SocialModule {}
