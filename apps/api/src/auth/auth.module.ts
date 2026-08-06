import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RedisModule } from '../redis/redis.module';
import { SiteSettingsModule } from '../site-settings/site-settings.module';
import { SecurityModule } from '../security/security.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';

@Module({
  imports: [JwtModule.register({}), RedisModule, UsersModule, SiteSettingsModule, SecurityModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, PasswordService, RefreshTokenService],
})
export class AuthModule {}
