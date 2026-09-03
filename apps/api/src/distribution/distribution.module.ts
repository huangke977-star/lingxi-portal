import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthModule } from "../auth/auth.module";
import { RedisModule } from "../redis/redis.module";
import { SecurityModule } from "../security/security.module";
import { SiteSettingsModule } from "../site-settings/site-settings.module";
import { UsersModule } from "../users/users.module";
import { DistributionController } from "./distribution.controller";
import { DistributionService } from "./distribution.service";

@Module({
  imports: [JwtModule.register({}), AuthModule, RedisModule, SecurityModule, SiteSettingsModule, UsersModule],
  controllers: [DistributionController],
  providers: [DistributionService],
  exports: [DistributionService],
})
export class DistributionModule {}
