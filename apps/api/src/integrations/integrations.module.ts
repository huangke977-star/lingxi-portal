import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserManagementGuard } from "../auth/guards/user-management.guard";
import { RedisModule } from "../redis/redis.module";
import { SecurityModule } from "../security/security.module";
import { UsersModule } from "../users/users.module";
import { IntegrationsController } from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";

@Module({ imports: [JwtModule.register({}), UsersModule, RedisModule, SecurityModule], controllers: [IntegrationsController], providers: [IntegrationsService, JwtAuthGuard, SuperAdminGuard, UserManagementGuard], exports: [IntegrationsService] })
export class IntegrationsModule {}
