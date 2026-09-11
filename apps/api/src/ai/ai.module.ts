import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { SecurityModule } from "../security/security.module";
import { RedisModule } from "../redis/redis.module";
import { UsersModule } from "../users/users.module";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";
import { UserManagementGuard } from "../auth/guards/user-management.guard";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";

@Module({
  imports: [JwtModule.register({}), RedisModule, SecurityModule, UsersModule],
  controllers: [AiController],
  providers: [AiService, JwtAuthGuard, SuperAdminGuard, UserManagementGuard],
})
export class AiModule {}
