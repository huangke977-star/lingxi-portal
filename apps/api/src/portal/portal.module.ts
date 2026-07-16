import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { UsersModule } from "../users/users.module";
import { PrismaService } from "../prisma/prisma.service";
import { PortalController } from "./portal.controller";
import { PortalService } from "./portal.service";

@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [PortalController],
  providers: [PrismaService, PortalService],
})
export class PortalModule {}
