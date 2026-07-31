import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { UsersModule } from "../users/users.module";
import { PrismaService } from "../prisma/prisma.service";
import { SiteSettingsController } from "./site-settings.controller";
import { SiteSettingsService } from "./site-settings.service";

@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [SiteSettingsController],
  providers: [PrismaService, SiteSettingsService],
  exports: [SiteSettingsService],
})
export class SiteSettingsModule {}
