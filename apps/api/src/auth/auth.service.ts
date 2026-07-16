import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import {
  AuthenticatedUser,
  AuthResponse,
  AuthSessionSummary,
  RefreshSessionContext,
} from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';

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
  ) {}

  async register(dto: RegisterDto, context: RefreshSessionContext): Promise<AuthResponse> {
    const username = dto.username.trim();
    const nickname = dto.nickname.trim();
    const email = dto.email.trim().toLowerCase();

    if ((await this.usersService.findForLogin(username)) || (await this.usersService.findForLogin(email))) {
      throw new ConflictException('Username or email already exists.');
    }

    const passwordHash = await this.passwordService.hashPassword(dto.password);
    const user = await this.usersService.createUser({ username, nickname, email, passwordHash });

    return this.createAuthResponse(user, context);
  }

  async login(dto: LoginDto, context: RefreshSessionContext): Promise<AuthResponse> {
    const account = dto.account.trim();
    const failureKey = this.loginFailureKey(account, context.ip);
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
      await this.recordLoginFailure(failureKey);
    }

    await this.redis.del(failureKey);
    await this.usersService.markLoginSuccess(user.id);
    return this.createAuthResponse(user, context);
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    const rotated = await this.refreshTokenService.rotate(refreshToken);
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
  ): Promise<{ sessions: AuthSessionSummary[] }> {
    return {
      sessions: await this.refreshTokenService.listSessions(
        userId,
        sessionId,
      ),
    };
  }

  async revokeOtherSessions(
    userId: number,
    sessionId: string | null,
  ): Promise<{ revokedSessions: number }> {
    return {
      revokedSessions: await this.refreshTokenService.revokeOtherSessions(
        userId,
        sessionId,
      ),
    };
  }

  async revokeAllSessions(
    userId: number,
  ): Promise<{ revokedSessions: number }> {
    return {
      revokedSessions: await this.refreshTokenService.revokeAllSessions(userId),
    };
  }

  me(user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  private async createAuthResponse(
    user: AuthenticatedUser,
    context: RefreshSessionContext,
  ): Promise<AuthResponse> {
    const refresh = await this.refreshTokenService.issue(user.id, context);
    return {
      user: this.toPublicUser(user),
      accessToken: await this.signAccessToken(user, refresh.tokenId),
      refreshToken: refresh.refreshToken,
    };
  }

  private async signAccessToken(
    user: AuthenticatedUser,
    sessionId: string,
  ): Promise<string> {
    return this.jwtService.signAsync(
      {
        sub: user.id,
        username: user.username,
        sid: sessionId,
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

  private async recordLoginFailure(failureKey: string): Promise<never> {
    const failures = await this.redis.incr(failureKey);
    if (failures === 1) {
      await this.redis.expire(failureKey, this.loginFailureTtlSeconds);
    }

    if (failures >= this.loginFailureLimit) {
      throw new ForbiddenException('Too many failed login attempts.');
    }

    throw new UnauthorizedException('Invalid credentials.');
  }

  private loginFailureKey(account: string, ip: string): string {
    return `login_fail:${account.toLowerCase()}:${ip}`;
  }
}
