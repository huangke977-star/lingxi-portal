import { forwardRef, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthModule } from "../auth/auth.module";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RedisModule } from "../redis/redis.module";
import { SecurityModule } from "../security/security.module";
import { UsersModule } from "../users/users.module";
import { AccountPrivacyController } from "./account-privacy.controller";
import { AccountPrivacyService } from "./account-privacy.service";
import { TotpService } from "./totp.service";

@Module({
  imports: [JwtModule.register({}), RedisModule, UsersModule, forwardRef(() => AuthModule), SecurityModule],
  controllers: [AccountPrivacyController],
  providers: [AccountPrivacyService, JwtAuthGuard, TotpService],
  exports: [AccountPrivacyService],
})
export class AccountPrivacyModule {}
