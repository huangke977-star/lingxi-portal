import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { UsersModule } from "../users/users.module";
import { PortalController } from "./portal.controller";
import { PortalService } from "./portal.service";

@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
