import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { UsersModule } from "../users/users.module";
import { DiscoveryController } from "./discovery.controller";
import { DiscoveryService } from "./discovery.service";

@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [DiscoveryController],
  providers: [DiscoveryService],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
