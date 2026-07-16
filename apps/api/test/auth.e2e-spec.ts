import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';

interface StoredUser {
  id: number;
  username: string;
  nickname: string;
  email: string;
  passwordHash: string;
  roleId: number;
  isSuperAdmin: boolean;
  status: 'active' | 'disabled';
  profileBio: string;
  lastLoginAt: Date | null;
  createdAt: Date;
}

const roles = [
  { id: 1, code: 'qi_refining', name: '练气', level: 10 },
  { id: 9, code: 'administrator', name: '管理员', level: 90 },
];

function createPrismaMock() {
  const users: StoredUser[] = [];
  const withRole = (user: StoredUser) => ({
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    email: user.email,
    passwordHash: user.passwordHash,
    status: user.status,
    isSuperAdmin: user.isSuperAdmin,
    appearanceThemeId: 'sakura-mist',
    customAccent: '#db2777',
    customSurface: '#ffffff',
    customForeground: '#2b2530',
    customMuted: '#665867',
    cardAlpha: 52,
    glassBlur: 22,
    glassTint: '#fff3f6',
    glassTintAlpha: 72,
    avatarStoredName: null,
    avatarMimeType: null,
    profileBio: user.profileBio,
    createdAt: user.createdAt,
    role: roles.find((role) => role.id === user.roleId) ?? roles[0],
  });

  return {
    users,
    prisma: {
      role: {
        findUnique: jest.fn(async ({ where }: { where: { code: string } }) => {
          return roles.find((role) => role.code === where.code) ?? null;
        }),
      },
      user: {
        create: jest.fn(
          async ({
            data,
          }: {
            data: {
              username: string;
              nickname: string;
              email: string;
              passwordHash: string;
              roleId: number;
              profileBio?: string;
            };
          }) => {
            const user: StoredUser = {
              id: users.length + 1,
              username: data.username,
              nickname: data.nickname,
              email: data.email,
              passwordHash: data.passwordHash,
              roleId: data.roleId,
              isSuperAdmin: false,
              status: 'active',
              profileBio: data.profileBio ?? '我懒，我不写',
              lastLoginAt: null,
              createdAt: new Date('2026-07-14T00:00:00.000Z'),
            };
            users.push(user);
            return withRole(user);
          },
        ),
        findFirst: jest.fn(async ({ where }: { where: { OR: Array<{ username?: string; email?: string }> } }) => {
          const user = users.find((item) => {
            return where.OR.some((condition) => {
              return (
                (condition.username !== undefined && item.username === condition.username) ||
                (condition.email !== undefined && item.email === condition.email)
              );
            });
          });

          return user ? withRole(user) : null;
        }),
        findUnique: jest.fn(async ({ where }: { where: { id?: number; username?: string; email?: string } }) => {
          const user = users.find((item) => {
            return (
              (where.id !== undefined && item.id === where.id) ||
              (where.username !== undefined && item.username === where.username) ||
              (where.email !== undefined && item.email === where.email)
            );
          });

          return user ? withRole(user) : null;
        }),
        update: jest.fn(async ({ where, data }: { where: { id: number }; data: Partial<StoredUser> }) => {
          const user = users.find((item) => item.id === where.id);
          if (!user) {
            throw new Error('User not found');
          }

          Object.assign(user, data);
          return withRole(user);
        }),
      },
    },
  };
}

function createRedisMock() {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();

  const deleteKey = (key: string) => {
    const deletedString = store.delete(key);
    const deletedSet = sets.delete(key);
    return deletedString || deletedSet ? 1 : 0;
  };

  return {
    store,
    sets,
    redis: {
      set: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      del: jest.fn(async (key: string) => deleteKey(key)),
      delMany: jest.fn(async (keys: string[]) => {
        return keys.reduce((deleted, key) => deleted + deleteKey(key), 0);
      }),
      sadd: jest.fn(async (key: string, value: string) => {
        const set = sets.get(key) ?? new Set<string>();
        set.add(value);
        sets.set(key, set);
        return 1;
      }),
      srem: jest.fn(async (key: string, value: string) => {
        return sets.get(key)?.delete(value) ? 1 : 0;
      }),
      smembers: jest.fn(async (key: string) => [...(sets.get(key) ?? [])]),
      scard: jest.fn(async (key: string) => sets.get(key)?.size ?? 0),
      incr: jest.fn(async (key: string) => {
        const next = Number(store.get(key) ?? '0') + 1;
        store.set(key, String(next));
        return next;
      }),
      expire: jest.fn(async () => 1),
    },
  };
}

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  let prismaState: ReturnType<typeof createPrismaMock>;
  let redisState: ReturnType<typeof createRedisMock>;

  beforeEach(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access-token-secret';
    process.env.JWT_ACCESS_EXPIRES_IN = '15m';
    process.env.REFRESH_TOKEN_SECRET = 'test-refresh-token-secret';
    process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS = '30';
    process.env.MAX_REFRESH_SESSIONS_PER_USER = '10';

    prismaState = createPrismaMock();
    redisState = createRedisMock();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaState.prisma)
      .overrideProvider(RedisService)
      .useValue(redisState.redis)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  function register(username = 'tester', email = 'tester@example.com', nickname = '测试昵称') {
    return request(app.getHttpServer()).post('/auth/register').send({
      username,
      nickname,
      email,
      password: 'Secret123!',
    });
  }

  it('registers a user with the qi_refining role', async () => {
    const response = await register().expect(200);

    expect(response.body.user).toMatchObject({
      username: 'tester',
      nickname: '测试昵称',
      email: 'tester@example.com',
      status: 'active',
      isSuperAdmin: false,
      role: { code: 'qi_refining', name: '练气', level: 10 },
    });
    expect(response.body.user.profileBio).toEqual(expect.any(String));
    expect(response.body.user.createdAt).toEqual(expect.any(String));
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toEqual(expect.any(String));
    expect(response.body.user.passwordHash).toBeUndefined();
    expect(readJwtPayload(response.body.accessToken as string).sid).toEqual(
      expect.any(String),
    );
  });

  it('rejects duplicate username or email', async () => {
    await register().expect(200);

    await register('tester', 'other@example.com').expect(409);
    await register('other', 'tester@example.com').expect(409);
  });

  it('requires a nickname during registration', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ username: 'missing_nickname', email: 'missing@example.com', password: 'Secret123!' })
      .expect(400);
  });

  it('rejects reserved nicknames during registration', async () => {
    await register('reserved_user', 'reserved@example.com', '超级管理员').expect(400);
  });

  it('logs in with username and returns tokens', async () => {
    await register('login_user', 'login@example.com').expect(200);

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account: 'login_user', password: 'Secret123!' })
      .expect(200);

    expect(response.body.user.username).toBe('login_user');
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toEqual(expect.any(String));
  });

  it('logs in with email and returns tokens', async () => {
    await register('email_user', 'email-login@example.com').expect(200);

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account: 'email-login@example.com', password: 'Secret123!' })
      .expect(200);

    expect(response.body.user.username).toBe('email_user');
  });

  it('rejects wrong passwords and blocks after five failures', async () => {
    await register('locked_user', 'locked@example.com').expect(200);

    for (let index = 0; index < 4; index += 1) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ account: 'locked_user', password: 'bad-password' })
        .expect(401);
    }

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account: 'locked_user', password: 'bad-password' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account: 'locked_user', password: 'Secret123!' })
      .expect(403);
  });

  it('refreshes by rotating refresh token state', async () => {
    const registered = await register('refresh_user', 'refresh@example.com').expect(200);
    const firstRefreshToken = registered.body.refreshToken as string;
    const firstTokenId = firstRefreshToken.split('.')[0];
    const storedRecord = JSON.parse(
      redisState.store.get(`refresh_token:${firstTokenId}`) ?? '{}',
    ) as Record<string, unknown>;
    delete storedRecord.ip;
    delete storedRecord.userAgent;
    redisState.store.set(`refresh_token:${firstTokenId}`, JSON.stringify(storedRecord));

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('User-Agent', 'Backfilled Chrome session')
      .set('X-Forwarded-For', '198.51.100.24')
      .send({ refreshToken: firstRefreshToken })
      .expect(200);

    expect(refreshed.body.refreshToken).not.toBe(firstRefreshToken);
    const sessions = await request(app.getHttpServer())
      .post('/auth/sessions')
      .set('User-Agent', 'Backfilled Chrome session')
      .set('X-Forwarded-For', '198.51.100.24')
      .set('Authorization', `Bearer ${refreshed.body.accessToken as string}`)
      .expect(200);
    expect(sessions.body.sessions).toEqual([
      expect.objectContaining({
        current: true,
        ip: '198.51.100.24',
        userAgent: 'Backfilled Chrome session',
      }),
    ]);
    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: firstRefreshToken }).expect(401);
  });

  it('logs out by revoking refresh token state', async () => {
    const registered = await register('logout_user', 'logout@example.com').expect(200);
    const refreshToken = registered.body.refreshToken as string;

    await request(app.getHttpServer()).post('/auth/logout').send({ refreshToken }).expect(200);
    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken }).expect(401);
  });

  it('lists login sessions and marks the access-token session as current', async () => {
    await register('sessions_user', 'sessions@example.com').expect(200);
    const loggedIn = await request(app.getHttpServer())
      .post('/auth/login')
      .set('User-Agent', 'HLOVET session test')
      .set('X-Forwarded-For', '203.0.113.18')
      .send({ account: 'sessions_user', password: 'Secret123!' })
      .expect(200);
    const currentTokenId = readJwtPayload(loggedIn.body.accessToken as string).sid as string;
    const currentRecord = JSON.parse(
      redisState.store.get(`refresh_token:${currentTokenId}`) ?? '{}',
    ) as Record<string, unknown>;
    delete currentRecord.ip;
    delete currentRecord.userAgent;
    redisState.store.set(`refresh_token:${currentTokenId}`, JSON.stringify(currentRecord));

    const response = await request(app.getHttpServer())
      .post('/auth/sessions')
      .set('User-Agent', 'Current profile device')
      .set('X-Forwarded-For', '203.0.113.19')
      .set('Authorization', `Bearer ${loggedIn.body.accessToken as string}`)
      .expect(200);

    expect(response.body.sessions).toHaveLength(2);
    expect(response.body.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: currentTokenId,
          current: true,
          ip: '203.0.113.19',
          userAgent: 'Current profile device',
        }),
      ]),
    );
  });

  it('revokes other login sessions without revoking the current session', async () => {
    const registered = await register('revoke_others', 'revoke-others@example.com').expect(200);
    const otherRefreshToken = registered.body.refreshToken as string;
    const current = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account: 'revoke_others', password: 'Secret123!' })
      .expect(200);

    const revoked = await request(app.getHttpServer())
      .post('/auth/sessions/revoke-others')
      .set('Authorization', `Bearer ${current.body.accessToken as string}`)
      .expect(200);

    expect(revoked.body).toEqual({ revokedSessions: 1 });
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: otherRefreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: current.body.refreshToken as string })
      .expect(200);
  });

  it('revokes all login sessions for the current account', async () => {
    const registered = await register('revoke_all', 'revoke-all@example.com').expect(200);

    const revoked = await request(app.getHttpServer())
      .post('/auth/sessions/revoke-all')
      .set('Authorization', `Bearer ${registered.body.accessToken as string}`)
      .expect(200);

    expect(revoked.body).toEqual({ revokedSessions: 1 });
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: registered.body.refreshToken as string })
      .expect(401);
  });

  it('keeps only the ten newest login sessions per account', async () => {
    process.env.MAX_REFRESH_SESSIONS_PER_USER = '10';
    const issuedRefreshTokens: string[] = [];
    const registered = await register('session_limit', 'session-limit@example.com').expect(200);
    issuedRefreshTokens.push(registered.body.refreshToken as string);
    let latestAccessToken = registered.body.accessToken as string;

    for (let index = 0; index < 10; index += 1) {
      const loggedIn = await request(app.getHttpServer())
        .post('/auth/login')
        .set('User-Agent', `Session ${index + 2}`)
        .send({ account: 'session_limit', password: 'Secret123!' })
        .expect(200);
      issuedRefreshTokens.push(loggedIn.body.refreshToken as string);
      latestAccessToken = loggedIn.body.accessToken as string;
    }

    const sessions = await request(app.getHttpServer())
      .post('/auth/sessions')
      .set('Authorization', `Bearer ${latestAccessToken}`)
      .expect(200);

    expect(sessions.body.sessions).toHaveLength(10);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: issuedRefreshTokens[0] })
      .expect(401);
  });

  it('removes stale ids from the user session index', async () => {
    const registered = await register('stale_session', 'stale-session@example.com').expect(200);
    const user = prismaState.users.find((item) => item.username === 'stale_session');
    if (!user) {
      throw new Error('Expected stale_session to exist');
    }
    redisState.sets.get(`user_sessions:${user.id}`)?.add('missing-token-id');

    await request(app.getHttpServer())
      .post('/auth/sessions')
      .set('Authorization', `Bearer ${registered.body.accessToken as string}`)
      .expect(200);

    expect(redisState.sets.get(`user_sessions:${user.id}`)).not.toContain(
      'missing-token-id',
    );
  });

  it('returns /auth/me for a valid access token', async () => {
    const registered = await register('me_user', 'me@example.com').expect(200);
    const accessToken = registered.body.accessToken as string;

    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      username: 'me_user',
      nickname: '测试昵称',
      profileBio: expect.any(String),
      role: { code: 'qi_refining', name: '练气', level: 10 },
    });
  });

  it('updates current user nickname, email, and profile bio', async () => {
    const registered = await register('bio_user', 'bio@example.com').expect(200);
    const accessToken = registered.body.accessToken as string;

    const response = await request(app.getHttpServer())
      .patch('/auth/me/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ nickname: '一颗测试星', email: 'BIO-UPDATED@example.com', profileBio: '我就喜欢这个范。' })
      .expect(200);

    expect(response.body.nickname).toBe('一颗测试星');
    expect(response.body.email).toBe('bio-updated@example.com');
    expect(response.body.profileBio).toBe('我就喜欢这个范。');
    expect(prismaState.users.find((item) => item.username === 'bio_user')?.nickname).toBe('一颗测试星');
    expect(prismaState.users.find((item) => item.username === 'bio_user')?.email).toBe('bio-updated@example.com');
    expect(prismaState.users.find((item) => item.username === 'bio_user')?.profileBio).toBe('我就喜欢这个范。');
  });

  it('rejects an email already used by another account', async () => {
    const registered = await register('email_owner', 'owner@example.com').expect(200);
    await register('email_target', 'target@example.com').expect(200);

    await request(app.getHttpServer())
      .patch('/auth/me/profile')
      .set('Authorization', `Bearer ${registered.body.accessToken as string}`)
      .send({ nickname: '测试昵称', email: 'target@example.com', profileBio: '保持原样。' })
      .expect(409);
  });

  it('rejects reserved nicknames', async () => {
    const registered = await register('nickname_user', 'nickname@example.com').expect(200);
    const accessToken = registered.body.accessToken as string;

    await request(app.getHttpServer())
      .patch('/auth/me/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ nickname: '超级管理员', email: 'nickname@example.com', profileBio: '保持原样。' })
      .expect(400);
  });

  it('rejects disabled users during login and refresh', async () => {
    const registered = await register('disabled_user', 'disabled@example.com').expect(200);
    const refreshToken = registered.body.refreshToken as string;
    const user = prismaState.users.find((item) => item.username === 'disabled_user');
    if (!user) {
      throw new Error('Expected disabled_user to exist');
    }
    user.status = 'disabled';

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account: 'disabled_user', password: 'Secret123!' })
      .expect(403);
    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken }).expect(403);
  });
});

function readJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) {
    throw new Error('Expected a JWT payload.');
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}
