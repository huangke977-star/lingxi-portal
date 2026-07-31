import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { RedisModule } from "../redis/redis.module";
import { UsersModule } from "../users/users.module";
import { SystemStatusController } from "./system-status.controller";
import { SystemStatusService } from "./system-status.service";

@Module({
  imports: [JwtModule.register({}), RedisModule, UsersModule],
  controllers: [SystemStatusController],
  providers: [PrismaService, SystemStatusService],
})
export class SystemStatusModule {}
