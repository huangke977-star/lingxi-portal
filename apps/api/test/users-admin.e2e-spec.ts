import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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
  profileBio: string;
  lastLoginAt: Date | null;
  createdAt: Date;
}

const roles = [
  { id: 1, code: 'qi_refining', name: '练气', level: 10 },
  { id: 3, code: 'golden_core', name: '金丹', level: 30 },
  { id: 9, code: 'administrator', name: '管理员', level: 90 },
];

function createPrismaMock() {
  const users: StoredUser[] = [
    {
      id: 1,
      username: 'admin',
      email: 'admin@example.com',
      passwordHash: 'hash',
      roleId: 9,
      isSuperAdmin: true,
      status: 'active',
      profileBio: '我懒，我不写',
      lastLoginAt: null,
      createdAt: new Date('2026-07-14T00:00:00.000Z'),
    },
    {
      id: 2,
      username: 'normal',
      email: 'normal@example.com',
      passwordHash: 'hash',
      roleId: 1,
      isSuperAdmin: false,
      status: 'active',
      profileBio: '我高冷，我不写。',
      lastLoginAt: null,
      createdAt: new Date('2026-07-14T00:00:00.000Z'),
    },
  ];
  const withRole = (user: StoredUser) => ({
    id: user.id,
    username: user.username,
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
        findMany: jest.fn(async () => users.map(withRole)),
        findUnique: jest.fn(async ({ where }: { where: { id?: number } }) => {
          const user = users.find((item) => item.id === where.id);
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

describe('admin user management (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let state: ReturnType<typeof createPrismaMock>;

  beforeEach(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access-token-secret';
    process.env.JWT_ACCESS_EXPIRES_IN = '15m';

    state = createPrismaMock();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(state.prisma)
      .overrideProvider(RedisService)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterEach(async () => {
    await app?.close();
  });

  async function tokenFor(userId: number) {
    const user = state.users.find((item) => item.id === userId);
    if (!user) {
      throw new Error(`Missing user ${userId}`);
    }

    return jwt.signAsync(
      { sub: user.id, username: user.username },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' },
    );
  }

  it('allows super admin to list users without password hashes', async () => {
    const token = await tokenFor(1);

    const response = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toHaveLength(2);
    expect(response.body[0]).toMatchObject({
      username: 'admin',
      role: { code: 'administrator', name: '管理员', level: 90 },
    });
    expect(response.body[0].passwordHash).toBeUndefined();
  });

  it('allows super admin to assign roles', async () => {
    const token = await tokenFor(1);

    await request(app.getHttpServer())
      .patch('/users/2/role')
      .set('Authorization', `Bearer ${token}`)
      .send({ roleCode: 'golden_core' })
      .expect(200);

    expect(state.users[1].roleId).toBe(3);
  });

  it('allows super admin to update user status', async () => {
    const token = await tokenFor(1);

    await request(app.getHttpServer())
      .patch('/users/2/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'disabled' })
      .expect(200);

    expect(state.users[1].status).toBe('disabled');
  });

  it('allows super admin to update user passwords without returning password hashes', async () => {
    const token = await tokenFor(1);
    const previousHash = state.users[1].passwordHash;

    const response = await request(app.getHttpServer())
      .patch('/users/2/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'NewSecret123!' })
      .expect(200);

    expect(state.users[1].passwordHash).not.toBe(previousHash);
    expect(state.users[1].passwordHash).not.toBe('NewSecret123!');
    expect(response.body).toMatchObject({
      id: 2,
      username: 'normal',
    });
    expect(response.body.passwordHash).toBeUndefined();
  });

  it('rejects non-super-admin users from updating user passwords', async () => {
    const token = await tokenFor(2);

    await request(app.getHttpServer())
      .patch('/users/1/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'OtherSecret123!' })
      .expect(403);
  });

  it('rejects short password updates', async () => {
    const token = await tokenFor(1);

    await request(app.getHttpServer())
      .patch('/users/2/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'short' })
      .expect(400);
  });

  it('rejects non-super-admin users', async () => {
    const token = await tokenFor(2);

    await request(app.getHttpServer()).get('/users').set('Authorization', `Bearer ${token}`).expect(403);
  });
});
