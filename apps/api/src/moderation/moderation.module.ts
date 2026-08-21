import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserManagementGuard } from "../auth/guards/user-management.guard";
import { PrismaModule } from "../prisma/prisma.module";
import { RedisModule } from "../redis/redis.module";
import { UsersModule } from "../users/users.module";
import { ModerationController } from "./moderation.controller";
import { ModerationService } from "./moderation.service";

@Module({
  imports: [JwtModule.register({}), PrismaModule, RedisModule, UsersModule],
  controllers: [ModerationController],
  providers: [ModerationService, JwtAuthGuard, UserManagementGuard],
})
export class ModerationModule {}
