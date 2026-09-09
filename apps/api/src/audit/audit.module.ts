import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { UsersModule } from "../users/users.module";
import { AuditController } from "./audit.controller";
import { AuditInterceptor } from "./audit.interceptor";
import { AuditService } from "./audit.service";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";

@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [AuditController],
  providers: [
    AuditService,
    SuperAdminGuard,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AuditModule {}
