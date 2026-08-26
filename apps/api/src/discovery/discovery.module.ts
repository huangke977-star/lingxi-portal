import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { SocialModule } from "../social/social.module";
import { UsersModule } from "../users/users.module";
import { DiscoveryController } from "./discovery.controller";
import { DiscoveryService } from "./discovery.service";

@Module({
  imports: [JwtModule.register({}), UsersModule, SocialModule],
  controllers: [DiscoveryController],
  providers: [DiscoveryService],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
