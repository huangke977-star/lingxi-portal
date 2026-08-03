import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { UsersModule } from "../users/users.module";
import { PushController } from "./push.controller";
import { PushService } from "./push.service";

@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [PushController],
  providers: [PrismaService, PushService],
  exports: [PushService],
})
export class PushModule {}
