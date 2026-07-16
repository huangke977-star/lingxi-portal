import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import {
  AuthenticatedUser,
  AuthSessionSummary,
  RefreshSessionContext,
} from './auth.types';

interface StoredRefreshToken {
  userId: number;
  tokenHash: string;
  issuedAt: string;
  expiresAt: string;
  ip?: string;
  userAgent?: string;
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

  async issue(
    userId: number,
    context: RefreshSessionContext = { ip: 'unknown', userAgent: 'unknown' },
    issuedAt = new Date().toISOString(),
  ): Promise<{ refreshToken: string; tokenId: string; expiresAt: Date }> {
    const tokenId = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const refreshToken = `${tokenId}.${secret}`;
    const expiresAt = this.createExpiryDate();
    const record: StoredRefreshToken = {
      userId,
      tokenHash: this.hashToken(refreshToken),
      issuedAt,
      expiresAt: expiresAt.toISOString(),
      ip: context.ip,
      userAgent: context.userAgent,
    };

    await this.redis.set(this.tokenKey(tokenId), JSON.stringify(record), this.refreshTtlSeconds());
    const sessionsKey = this.userSessionsKey(userId);
    await this.redis.sadd(sessionsKey, tokenId);
    await this.redis.expire(sessionsKey, this.refreshTtlSeconds());
    await this.cleanAndLimitSessions(userId, tokenId);

    return { refreshToken, tokenId, expiresAt };
  }

  async rotate(
    refreshToken: string,
    context: RefreshSessionContext = { ip: 'unknown', userAgent: 'unknown' },
  ): Promise<{
    refreshToken: string;
    tokenId: string;
    expiresAt: Date;
    user: AuthenticatedUser;
  }> {
    const parsed = this.parseToken(refreshToken);
    if (!parsed) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const record = await this.requireRecord(parsed, refreshToken);

    if (new Date(record.expiresAt).getTime() <= Date.now()) {
      await this.revoke(refreshToken);
      throw new UnauthorizedException('Refresh token expired.');
    }

    const user = await this.usersService.findActiveById(record.userId);
    await this.revoke(refreshToken);
    const next = await this.issue(
      record.userId,
      this.mergeSessionContext(record, context),
      record.issuedAt,
    );

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
      await this.removeSessionIndexEntry(record.userId, parsed.tokenId);
    }
  }

  async listSessions(
    userId: number,
    currentTokenId: string | null,
    context: RefreshSessionContext = { ip: 'unknown', userAgent: 'unknown' },
  ): Promise<AuthSessionSummary[]> {
    const current = await this.requireUserSession(userId, currentTokenId);
    await this.updateSessionContext(current.tokenId, current.record, context);
    await this.repairCurrentSessionIndex(userId, current.tokenId);
    const sessions = await this.cleanAndLimitSessions(userId, current.tokenId);
    return sessions.map(({ tokenId, record }) => ({
      id: tokenId,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
      ip: record.ip ?? 'unknown',
      userAgent: record.userAgent ?? 'unknown',
      current: tokenId === current.tokenId,
    }));
  }

  async revokeOtherSessions(
    userId: number,
    currentTokenId: string | null,
  ): Promise<number> {
    const current = await this.requireUserSession(userId, currentTokenId);
    await this.repairCurrentSessionIndex(userId, current.tokenId);
    const sessions = await this.cleanAndLimitSessions(userId, current.tokenId);
    const revokeIds = sessions
      .map((session) => session.tokenId)
      .filter((tokenId) => tokenId !== current.tokenId);
    return this.revokeTokenIds(userId, revokeIds);
  }

  async revokeAllSessions(userId: number): Promise<number> {
    const tokenIds = await this.redis.smembers(this.userSessionsKey(userId));
    const revoked = await this.redis.delMany(
      tokenIds.map((tokenId) => this.tokenKey(tokenId)),
    );
    await this.redis.del(this.userSessionsKey(userId));
    return revoked;
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

    try {
      return JSON.parse(value) as StoredRefreshToken;
    } catch {
      return null;
    }
  }

  private async requireRecord(
    parsed: ParsedRefreshToken,
    refreshToken: string,
  ): Promise<StoredRefreshToken> {
    const record = await this.loadRecord(parsed.tokenId);
    if (!record || !this.tokenMatches(refreshToken, record.tokenHash)) {
      throw new UnauthorizedException('Invalid refresh token.');
    }
    return record;
  }

  private async requireUserSession(
    userId: number,
    tokenId: string | null,
  ): Promise<{ tokenId: string; record: StoredRefreshToken }> {
    if (!tokenId) {
      throw new UnauthorizedException('Invalid refresh token.');
    }
    const record = await this.loadRecord(tokenId);
    if (!record || record.userId !== userId) {
      throw new UnauthorizedException('Invalid refresh token.');
    }
    return { tokenId, record };
  }

  private async repairCurrentSessionIndex(
    userId: number,
    tokenId: string,
  ): Promise<void> {
    const sessionsKey = this.userSessionsKey(userId);
    await this.redis.sadd(sessionsKey, tokenId);
    await this.redis.expire(sessionsKey, this.refreshTtlSeconds());
  }

  private async updateSessionContext(
    tokenId: string,
    record: StoredRefreshToken,
    context: RefreshSessionContext,
  ): Promise<void> {
    const merged = this.mergeSessionContext(record, context);
    if (merged.ip === record.ip && merged.userAgent === record.userAgent) {
      return;
    }
    const ttlSeconds = Math.max(
      1,
      Math.ceil((Date.parse(record.expiresAt) - Date.now()) / 1000),
    );
    await this.redis.set(
      this.tokenKey(tokenId),
      JSON.stringify({ ...record, ...merged }),
      ttlSeconds,
    );
  }

  private mergeSessionContext(
    record: StoredRefreshToken,
    context: RefreshSessionContext,
  ): RefreshSessionContext {
    return {
      ip: context.ip !== 'unknown' ? context.ip : record.ip ?? 'unknown',
      userAgent:
        context.userAgent !== 'unknown'
          ? context.userAgent
          : record.userAgent ?? 'unknown',
    };
  }

  private async cleanAndLimitSessions(
    userId: number,
    currentTokenId?: string,
  ): Promise<Array<{ tokenId: string; record: StoredRefreshToken }>> {
    const sessionsKey = this.userSessionsKey(userId);
    const tokenIds = await this.redis.smembers(sessionsKey);
    const loaded = await Promise.all(
      tokenIds.map(async (tokenId) => ({
        tokenId,
        record: await this.loadRecord(tokenId),
      })),
    );
    const staleIds = loaded
      .filter((session) => !session.record)
      .map((session) => session.tokenId);
    await Promise.all(staleIds.map((tokenId) => this.redis.srem(sessionsKey, tokenId)));

    const active = loaded.filter(
      (session): session is { tokenId: string; record: StoredRefreshToken } =>
        session.record !== null,
    );
    active.sort((left, right) => {
      if (left.tokenId === currentTokenId) return -1;
      if (right.tokenId === currentTokenId) return 1;
      return Date.parse(right.record.issuedAt) - Date.parse(left.record.issuedAt);
    });

    const kept = active.slice(0, this.maxSessionsPerUser());
    const excessIds = active
      .slice(this.maxSessionsPerUser())
      .map((session) => session.tokenId);
    await this.revokeTokenIds(userId, excessIds);

    if (kept.length === 0) {
      await this.redis.del(sessionsKey);
    } else {
      await this.redis.expire(sessionsKey, this.refreshTtlSeconds());
    }
    return kept;
  }

  private async revokeTokenIds(userId: number, tokenIds: string[]): Promise<number> {
    if (tokenIds.length === 0) {
      return 0;
    }
    const sessionsKey = this.userSessionsKey(userId);
    const revoked = await this.redis.delMany(
      tokenIds.map((tokenId) => this.tokenKey(tokenId)),
    );
    await Promise.all(tokenIds.map((tokenId) => this.redis.srem(sessionsKey, tokenId)));
    return revoked;
  }

  private async removeSessionIndexEntry(
    userId: number,
    tokenId: string,
  ): Promise<void> {
    const sessionsKey = this.userSessionsKey(userId);
    await this.redis.srem(sessionsKey, tokenId);
    if ((await this.redis.scard(sessionsKey)) === 0) {
      await this.redis.del(sessionsKey);
    }
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

  private maxSessionsPerUser(): number {
    const configured = Number(process.env.MAX_REFRESH_SESSIONS_PER_USER ?? 10);
    return Number.isInteger(configured) && configured > 0
      ? Math.min(configured, 100)
      : 10;
  }
}
