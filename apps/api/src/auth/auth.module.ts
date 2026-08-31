import { forwardRef, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RedisModule } from "../redis/redis.module";
import { SiteSettingsModule } from "../site-settings/site-settings.module";
import { SecurityModule } from "../security/security.module";
import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { OptionalJwtAuthGuard } from "./guards/optional-jwt-auth.guard";
import { PasswordService } from "./password.service";
import { RefreshTokenService } from "./refresh-token.service";
import { AccountPrivacyModule } from "../account-privacy/account-privacy.module";

@Module({
  imports: [JwtModule.register({}), RedisModule, UsersModule, SiteSettingsModule, SecurityModule, forwardRef(() => AccountPrivacyModule)],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, OptionalJwtAuthGuard, PasswordService, RefreshTokenService],
  exports: [JwtModule, JwtAuthGuard, OptionalJwtAuthGuard, PasswordService, RefreshTokenService],
})
export class AuthModule {}
