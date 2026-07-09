import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PasswordService } from '../src/auth/password.service';
import { RefreshTokenService } from '../src/auth/refresh-token.service';
import { UsersService } from '../src/users/users.service';

describe('auth support services', () => {
  beforeEach(() => {
    process.env.REFRESH_TOKEN_SECRET = 'test-refresh-token-secret';
    process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS = '30';
  });

  it('hashes passwords without returning plaintext', async () => {
    const service = new PasswordService();
    const hash = await service.hashPassword('Secret123!');

    expect(hash).not.toBe('Secret123!');
    await expect(service.verifyPassword('Secret123!', hash)).resolves.toBe(true);
    await expect(service.verifyPassword('bad', hash)).resolves.toBe(false);
  });

  it('rejects disabled users in active lookup', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 2,
          username: 'disabled',
          email: 'disabled@example.com',
          status: 'disabled',
          isSuperAdmin: false,
          role: { code: 'qi_refining', name: '练气', level: 10 },
        }),
      },
    };
    const service = new UsersService(prisma as never);

    await expect(service.findActiveById(2)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rotates refresh tokens by removing old state', async () => {
    const redisStore = new Map<string, string>();
    const redisSets = new Map<string, Set<string>>();
    const redis = {
      set: jest.fn(async (key: string, value: string) => {
        redisStore.set(key, value);
      }),
      get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
      del: jest.fn(async (key: string) => {
        redisStore.delete(key);
        return 1;
      }),
      sadd: jest.fn(async (key: string, value: string) => {
        const set = redisSets.get(key) ?? new Set<string>();
        set.add(value);
        redisSets.set(key, set);
      }),
      srem: jest.fn(async (key: string, value: string) => {
        redisSets.get(key)?.delete(value);
      }),
    };
    const users = {
      findActiveById: jest.fn().mockResolvedValue({
        id: 1,
        username: 'tester',
        email: 'tester@example.com',
        status: 'active',
        isSuperAdmin: false,
        role: { code: 'qi_refining', name: '练气', level: 10 },
      }),
    };
    const service = new RefreshTokenService(redis as never, users as never);

    const first = await service.issue(1);
    const second = await service.rotate(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expect(service.rotate(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
