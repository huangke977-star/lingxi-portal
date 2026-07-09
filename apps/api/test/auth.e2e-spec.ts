import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';

interface StoredUser {
  id: number;
  username: string;
  email: string;
  passwordHash: string;
  roleId: number;
  isSuperAdmin: boolean;
  status: 'active' | 'disabled';
  lastLoginAt: Date | null;
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
    email: user.email,
    passwordHash: user.passwordHash,
    status: user.status,
    isSuperAdmin: user.isSuperAdmin,
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
              email: string;
              passwordHash: string;
              roleId: number;
            };
          }) => {
            const user: StoredUser = {
              id: users.length + 1,
              username: data.username,
              email: data.email,
              passwordHash: data.passwordHash,
              roleId: data.roleId,
              isSuperAdmin: false,
              status: 'active',
              lastLoginAt: null,
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

  return {
    store,
    sets,
    redis: {
      set: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      del: jest.fn(async (key: string) => {
        store.delete(key);
        return 1;
      }),
      sadd: jest.fn(async (key: string, value: string) => {
        const set = sets.get(key) ?? new Set<string>();
        set.add(value);
        sets.set(key, set);
        return 1;
      }),
      srem: jest.fn(async (key: string, value: string) => {
        sets.get(key)?.delete(value);
        return 1;
      }),
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

  beforeEach(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access-token-secret';
    process.env.JWT_ACCESS_EXPIRES_IN = '15m';
    process.env.REFRESH_TOKEN_SECRET = 'test-refresh-token-secret';
    process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS = '30';

    prismaState = createPrismaMock();
    const redisState = createRedisMock();
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

  function register(username = 'tester', email = 'tester@example.com') {
    return request(app.getHttpServer()).post('/auth/register').send({
      username,
      email,
      password: 'Secret123!',
    });
  }

  it('registers a user with the qi_refining role', async () => {
    const response = await register().expect(200);

    expect(response.body.user).toMatchObject({
      username: 'tester',
      email: 'tester@example.com',
      status: 'active',
      isSuperAdmin: false,
      role: { code: 'qi_refining', name: '练气', level: 10 },
    });
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toEqual(expect.any(String));
    expect(response.body.user.passwordHash).toBeUndefined();
  });

  it('rejects duplicate username or email', async () => {
    await register().expect(200);

    await register('tester', 'other@example.com').expect(409);
    await register('other', 'tester@example.com').expect(409);
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

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: firstRefreshToken })
      .expect(200);

    expect(refreshed.body.refreshToken).not.toBe(firstRefreshToken);
    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: firstRefreshToken }).expect(401);
  });

  it('logs out by revoking refresh token state', async () => {
    const registered = await register('logout_user', 'logout@example.com').expect(200);
    const refreshToken = registered.body.refreshToken as string;

    await request(app.getHttpServer()).post('/auth/logout').send({ refreshToken }).expect(200);
    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken }).expect(401);
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
      role: { code: 'qi_refining', name: '练气', level: 10 },
    });
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
