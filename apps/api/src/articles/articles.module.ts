import { forwardRef, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthModule } from "../auth/auth.module";
import { UsersModule } from "../users/users.module";
import { SiteSettingsModule } from "../site-settings/site-settings.module";
import { RedisModule } from "../redis/redis.module";
import { ReputationModule } from "../reputation/reputation.module";
import { ModerationModule } from "../moderation/moderation.module";
import { SocialModule } from "../social/social.module";
import { ArticlesController } from "./articles.controller";
import { ArticlesService } from "./articles.service";
import { IntegrationsModule } from "../integrations/integrations.module";

@Module({
  imports: [JwtModule.register({}), AuthModule, UsersModule, SiteSettingsModule, RedisModule, ReputationModule, SocialModule, IntegrationsModule, forwardRef(() => ModerationModule)],
  controllers: [ArticlesController],
  providers: [ArticlesService],
  exports: [ArticlesService],
})
export class ArticlesModule {}
