import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";
import { UserManagementGuard } from "../auth/guards/user-management.guard";
import { RedisModule } from "../redis/redis.module";
import { UsersModule } from "../users/users.module";
import { AccountSecurityService } from "./account-security.service";
import { MailService } from "./mail.service";
import { SecretCryptoService } from "./secret-crypto.service";
import { SecurityAdminController } from "./security-admin.controller";
import { SecurityConfigurationService } from "./security-configuration.service";
import { TurnstileService } from "./turnstile.service";

@Module({
  imports: [JwtModule.register({}), RedisModule, UsersModule],
  controllers: [SecurityAdminController],
  providers: [
    AccountSecurityService,
    JwtAuthGuard,
    MailService,
    SecretCryptoService,
    SecurityConfigurationService,
    SuperAdminGuard,
    TurnstileService,
    UserManagementGuard,
  ],
  exports: [AccountSecurityService, MailService, SecurityConfigurationService, TurnstileService],
})
export class SecurityModule {}
