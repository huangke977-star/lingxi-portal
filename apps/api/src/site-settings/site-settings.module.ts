import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { UsersModule } from "../users/users.module";
import { SiteAssetsService } from "./site-assets.service";
import { SiteSettingsController } from "./site-settings.controller";
import { SiteSettingsService } from "./site-settings.service";

@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [SiteSettingsController],
  providers: [SiteSettingsService, SiteAssetsService],
  exports: [SiteSettingsService],
})
export class SiteSettingsModule {}
