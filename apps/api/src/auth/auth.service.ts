import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { RedisService } from '../redis/redis.service';
import { SiteSettingsService } from '../site-settings/site-settings.service';
import { UsersService } from '../users/users.service';
import {
  AuthenticatedUser,
  AuthResponse,
  AuthSessionSummary,
  LoginResponse,
  RefreshSessionContext,
} from './auth.types';
import { DeviceLoginVerificationDto, LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';
import { AccountSecurityService } from '../security/account-security.service';
import { SecurityConfigurationService } from '../security/security-configuration.service';
import { TurnstileService } from '../security/turnstile.service';
import { PasswordRecoveryResetDto } from '../security/dto/security.dto';
import { LoginSecurityEventType } from '../generated/prisma/client';

@Injectable()
export class AuthService {
  private readonly loginFailureTtlSeconds = 15 * 60;
  private readonly loginFailureLimit = 5;

  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    private readonly siteSettingsService: SiteSettingsService,
    private readonly accountSecurity: AccountSecurityService,
    private readonly securityConfiguration: SecurityConfigurationService,
    private readonly turnstile: TurnstileService,
  ) {}

  async register(dto: RegisterDto, context: RefreshSessionContext): Promise<AuthResponse> {
    const registrationPolicy = await this.siteSettingsService.getRegistrationPolicy();
    if (!registrationPolicy.registrationOpen) {
      throw new ForbiddenException('Registration is currently closed.');
    }

    const username = dto.username.trim();
    const nickname = dto.nickname.trim();
    const email = dto.email.trim().toLowerCase();
    const securityConfiguration = await this.securityConfiguration.getConfiguration();
    const registrationEmailVerificationEnabled =
      securityConfiguration.smtpEnabled && securityConfiguration.registrationEmailVerificationEnabled;

    if ((await this.usersService.findForLogin(username)) || (await this.usersService.findForLogin(email))) {
      throw new ConflictException('Username or email already exists.');
    }

    if (registrationEmailVerificationEnabled) {
      if (!dto.verificationCode) throw new BadRequestException('请输入邮箱验证码。');
      await this.accountSecurity.consumeRegistrationCode(email, dto.verificationCode);
    } else {
      await this.turnstile.verify(dto.turnstileToken, context.ip, securityConfiguration.turnstileRegistrationEnabled);
    }

    const passwordHash = await this.passwordService.hashPassword(dto.password);
    const user = await this.usersService.createUser({
      username,
      nickname,
      email,
      passwordHash,
      roleCode: registrationPolicy.defaultRoleCode,
      emailVerifiedAt: registrationEmailVerificationEnabled ? new Date() : null,
    });

    if (registrationEmailVerificationEnabled && context.trustedDeviceToken) {
      await this.accountSecurity.trustCurrentDevice(user.id, context);
    }
    await this.accountSecurity.recordRegistrationLogin(user, context);
    return this.createAuthResponse(user, context);
  }

  async login(dto: LoginDto, context: RefreshSessionContext): Promise<LoginResponse> {
    const account = dto.account.trim();
    const failureKey = this.loginFailureKey(account, context.ip);
    const failures = Number((await this.redis.get(failureKey)) ?? '0');
    const securityConfiguration = await this.securityConfiguration.getConfiguration();
    if (
      securityConfiguration.turnstileLoginEnabled &&
      failures >= securityConfiguration.loginFailureTurnstileThreshold
    ) {
      await this.turnstile.verify(dto.turnstileToken, context.ip, true);
    }
    await this.assertNotLocked(failureKey);

    const user = await this.usersService.findForLogin(account);
    if (!user) {
      await this.recordLoginFailure(failureKey);
    }

    if (user?.status !== 'active') {
      throw new ForbiddenException('User is disabled.');
    }

    const passwordMatches = await this.passwordService.verifyPassword(dto.password, user.passwordHash);
    if (!passwordMatches) {
      await this.recordLoginFailure(failureKey, user.id, context);
    }

    await this.redis.del(failureKey);
    if (
      securityConfiguration.smtpEnabled &&
      securityConfiguration.untrustedDeviceEmailVerificationEnabled &&
      !(await this.accountSecurity.isTrustedDevice(user.id, context))
    ) {
      return this.accountSecurity.requestDeviceLoginVerification(user, context);
    }
    await this.usersService.markLoginSuccess(user.id);
    await this.accountSecurity.recordLogin(user, context);
    return this.createAuthResponse(user, context);
  }

  async verifyDeviceLogin(dto: DeviceLoginVerificationDto, context: RefreshSessionContext): Promise<AuthResponse> {
    const verified = await this.accountSecurity.consumeDeviceLoginVerification(dto.challengeToken, dto.code, context);
    const user = await this.usersService.findActiveById(verified.userId);
    await this.usersService.markLoginSuccess(user.id);
    await this.accountSecurity.recordVerifiedDeviceLogin(user, context);
    return this.createAuthResponse(user, context);
  }

  async refresh(refreshToken: string, context: RefreshSessionContext): Promise<AuthResponse> {
    const rotated = await this.refreshTokenService.rotate(refreshToken, context);
    return {
      user: rotated.user,
      accessToken: await this.signAccessToken(rotated.user, rotated.tokenId),
      refreshToken: rotated.refreshToken,
    };
  }

  async logout(refreshToken: string): Promise<{ success: true }> {
    await this.refreshTokenService.revoke(refreshToken);
    return { success: true };
  }

  async listSessions(
    userId: number,
    sessionId: string | null,
    context: RefreshSessionContext,
  ): Promise<{ sessions: AuthSessionSummary[] }> {
    return {
      sessions: await this.refreshTokenService.listSessions(userId, sessionId, context),
    };
  }

  async revokeOtherSessions(userId: number, sessionId: string | null): Promise<{ revokedSessions: number }> {
    return {
      revokedSessions: await this.refreshTokenService.revokeOtherSessions(userId, sessionId),
    };
  }

  async revokeAllSessions(userId: number): Promise<{ revokedSessions: number }> {
    return {
      revokedSessions: await this.refreshTokenService.revokeAllSessions(userId),
    };
  }

  async revokeSession(
    userId: number,
    currentSessionId: string | null,
    targetSessionId: string,
  ): Promise<{ success: true; current: boolean }> {
    return this.refreshTokenService.revokeSession(userId, currentSessionId, targetSessionId);
  }

  me(user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  async changePassword(
    user: AuthenticatedUser,
    sessionId: string | null,
    dto: ChangePasswordDto,
    context: RefreshSessionContext,
  ): Promise<{ success: true; revokedSessions: number }> {
    const storedUser = await this.usersService.findForLogin(user.username);
    if (!storedUser) {
      throw new BadRequestException('Current password is incorrect.');
    }

    const currentPasswordMatches = await this.passwordService.verifyPassword(
      dto.currentPassword,
      storedUser.passwordHash,
    );
    if (!currentPasswordMatches) {
      throw new BadRequestException('Current password is incorrect.');
    }

    const passwordIsUnchanged = await this.passwordService.verifyPassword(dto.newPassword, storedUser.passwordHash);
    if (passwordIsUnchanged) {
      throw new BadRequestException('New password must be different.');
    }

    await this.usersService.updateOwnPassword(user.id, dto.newPassword);
    const revokedSessions = await this.refreshTokenService.revokeOtherSessions(user.id, sessionId);
    await this.accountSecurity.recordPasswordEvent(user.id, LoginSecurityEventType.password_changed, context);
    return { success: true, revokedSessions };
  }

  async resetPassword(
    dto: PasswordRecoveryResetDto,
    context: RefreshSessionContext,
  ): Promise<{ success: true; revokedSessions: number }> {
    const securityConfiguration = await this.securityConfiguration.getConfiguration();
    if (!securityConfiguration.smtpEnabled || !securityConfiguration.passwordRecoveryEnabled) {
      throw new BadRequestException('密码找回当前未启用。');
    }
    await this.turnstile.verify(dto.turnstileToken, context.ip, securityConfiguration.turnstileRecoveryEnabled);
    const request = await this.accountSecurity.consumePasswordResetToken(dto.token);
    await this.usersService.updateOwnPassword(request.userId, dto.newPassword, true);
    const revokedSessions = await this.refreshTokenService.revokeAllSessions(request.userId);
    await this.accountSecurity.recordPasswordEvent(request.userId, LoginSecurityEventType.password_reset, context);
    return { success: true, revokedSessions };
  }

  private async createAuthResponse(user: AuthenticatedUser, context: RefreshSessionContext): Promise<AuthResponse> {
    const refresh = await this.refreshTokenService.issue(user.id, context);
    return {
      user: this.toPublicUser(user),
      accessToken: await this.signAccessToken(user, refresh.tokenId),
      refreshToken: refresh.refreshToken,
    };
  }

  private async signAccessToken(user: AuthenticatedUser, sessionId: string): Promise<string> {
    return this.jwtService.signAsync(
      {
        sub: user.id,
        username: user.username,
        sid: sessionId,
        av: user.authVersion ?? 0,
      },
      {
        secret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-token-secret',
        expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ?? '15m') as JwtSignOptions['expiresIn'],
      },
    );
  }

  private toPublicUser(user: AuthenticatedUser): AuthenticatedUser {
    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      status: user.status,
      isSuperAdmin: user.isSuperAdmin,
      avatarUrl: user.avatarUrl,
      profileBio: user.profileBio,
      createdAt: user.createdAt,
      appearance: user.appearance,
      role: user.role,
    };
  }

  private async assertNotLocked(failureKey: string): Promise<void> {
    const failures = Number((await this.redis.get(failureKey)) ?? '0');
    if (failures >= this.loginFailureLimit) {
      throw new ForbiddenException('Too many failed login attempts.');
    }
  }

  private async recordLoginFailure(
    failureKey: string,
    userId?: number,
    context?: RefreshSessionContext,
  ): Promise<never> {
    const failures = await this.redis.incr(failureKey);
    if (failures === 1) {
      await this.redis.expire(failureKey, this.loginFailureTtlSeconds);
    }

    if (failures >= this.loginFailureLimit) {
      if (userId && context) await this.accountSecurity.recordBlockedLogin(userId, context);
      throw new ForbiddenException('Too many failed login attempts.');
    }

    throw new UnauthorizedException('Invalid credentials.');
  }

  private loginFailureKey(account: string, ip: string): string {
    return `login_fail:${account.toLowerCase()}:${ip}`;
  }
}
