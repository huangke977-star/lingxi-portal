import { forwardRef, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { UsersModule } from "../users/users.module";
import { SiteSettingsModule } from "../site-settings/site-settings.module";
import { RedisModule } from "../redis/redis.module";
import { ReputationModule } from "../reputation/reputation.module";
import { ModerationModule } from "../moderation/moderation.module";
import { ArticlesController } from "./articles.controller";
import { ArticlesService } from "./articles.service";

@Module({
  imports: [JwtModule.register({}), UsersModule, SiteSettingsModule, RedisModule, ReputationModule, forwardRef(() => ModerationModule)],
  controllers: [ArticlesController],
  providers: [ArticlesService],
  exports: [ArticlesService],
})
export class ArticlesModule {}
