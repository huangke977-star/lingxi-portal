import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import { AuthenticatedUser, AuthResponse } from './auth.types';
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

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const username = dto.username.trim();
    const nickname = dto.nickname.trim();
    const email = dto.email.trim().toLowerCase();

    if ((await this.usersService.findForLogin(username)) || (await this.usersService.findForLogin(email))) {
      throw new ConflictException('Username or email already exists.');
    }

    const passwordHash = await this.passwordService.hashPassword(dto.password);
    const user = await this.usersService.createUser({ username, nickname, email, passwordHash });

    return this.createAuthResponse(user);
  }

  async login(dto: LoginDto, ip: string): Promise<AuthResponse> {
    const account = dto.account.trim();
    const failureKey = this.loginFailureKey(account, ip);
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
    return this.createAuthResponse(user);
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    const rotated = await this.refreshTokenService.rotate(refreshToken);
    return {
      user: rotated.user,
      accessToken: await this.signAccessToken(rotated.user),
      refreshToken: rotated.refreshToken,
    };
  }

  async logout(refreshToken: string): Promise<{ success: true }> {
    await this.refreshTokenService.revoke(refreshToken);
    return { success: true };
  }

  me(user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  private async createAuthResponse(user: AuthenticatedUser): Promise<AuthResponse> {
    const refresh = await this.refreshTokenService.issue(user.id);
    return {
      user: this.toPublicUser(user),
      accessToken: await this.signAccessToken(user),
      refreshToken: refresh.refreshToken,
    };
  }

  private async signAccessToken(user: AuthenticatedUser): Promise<string> {
    return this.jwtService.signAsync(
      {
        sub: user.id,
        username: user.username,
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
