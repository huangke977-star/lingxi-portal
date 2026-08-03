import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { UsersModule } from "../users/users.module";
import { SiteSettingsModule } from "../site-settings/site-settings.module";
import { ArticlesController } from "./articles.controller";
import { ArticlesService } from "./articles.service";

@Module({
  imports: [JwtModule.register({}), UsersModule, SiteSettingsModule],
  controllers: [ArticlesController],
  providers: [ArticlesService],
})
export class ArticlesModule {}
