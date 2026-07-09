import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import { AuthenticatedUser } from './auth.types';

interface StoredRefreshToken {
  userId: number;
  tokenHash: string;
  issuedAt: string;
  expiresAt: string;
}

interface ParsedRefreshToken {
  tokenId: string;
  refreshToken: string;
}

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly redis: RedisService,
    private readonly usersService: UsersService,
  ) {}

  async issue(userId: number): Promise<{ refreshToken: string; tokenId: string; expiresAt: Date }> {
    const tokenId = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const refreshToken = `${tokenId}.${secret}`;
    const expiresAt = this.createExpiryDate();
    const record: StoredRefreshToken = {
      userId,
      tokenHash: this.hashToken(refreshToken),
      issuedAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    await this.redis.set(this.tokenKey(tokenId), JSON.stringify(record), this.refreshTtlSeconds());
    await this.redis.sadd(this.userSessionsKey(userId), tokenId);

    return { refreshToken, tokenId, expiresAt };
  }

  async rotate(refreshToken: string): Promise<{
    refreshToken: string;
    tokenId: string;
    expiresAt: Date;
    user: AuthenticatedUser;
  }> {
    const parsed = this.parseToken(refreshToken);
    if (!parsed) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const record = await this.loadRecord(parsed.tokenId);
    if (!record || !this.tokenMatches(refreshToken, record.tokenHash)) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    if (new Date(record.expiresAt).getTime() <= Date.now()) {
      await this.revoke(refreshToken);
      throw new UnauthorizedException('Refresh token expired.');
    }

    const user = await this.usersService.findActiveById(record.userId);
    await this.revoke(refreshToken);
    const next = await this.issue(record.userId);

    return { ...next, user };
  }

  async revoke(refreshToken: string): Promise<void> {
    const parsed = this.parseToken(refreshToken);
    if (!parsed) {
      return;
    }

    const record = await this.loadRecord(parsed.tokenId);
    await this.redis.del(this.tokenKey(parsed.tokenId));

    if (record) {
      await this.redis.srem(this.userSessionsKey(record.userId), parsed.tokenId);
    }
  }

  private parseToken(refreshToken: string): ParsedRefreshToken | null {
    const parts = refreshToken.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return null;
    }

    return {
      tokenId: parts[0],
      refreshToken,
    };
  }

  private async loadRecord(tokenId: string): Promise<StoredRefreshToken | null> {
    const value = await this.redis.get(this.tokenKey(tokenId));
    if (!value) {
      return null;
    }

    return JSON.parse(value) as StoredRefreshToken;
  }

  private hashToken(refreshToken: string): string {
    return createHmac('sha256', process.env.REFRESH_TOKEN_SECRET ?? 'dev-refresh-token-secret')
      .update(refreshToken)
      .digest('hex');
  }

  private tokenMatches(refreshToken: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hashToken(refreshToken), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');

    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private tokenKey(tokenId: string): string {
    return `refresh_token:${tokenId}`;
  }

  private userSessionsKey(userId: number): string {
    return `user_sessions:${userId}`;
  }

  private createExpiryDate(): Date {
    return new Date(Date.now() + this.refreshTtlSeconds() * 1000);
  }

  private refreshTtlSeconds(): number {
    const days = Number(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS ?? 30);
    return days * 24 * 60 * 60;
  }
}
