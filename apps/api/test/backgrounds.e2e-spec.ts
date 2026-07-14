import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';

interface StoredBackground {
  id: number;
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  isActive: boolean;
  uploadedById: number;
  createdAt: Date;
  updatedAt: Date;
}

const users = [
  {
    id: 1,
    username: 'admin',
    email: 'admin@example.com',
    status: 'active',
    isSuperAdmin: true,
    role: { code: 'administrator', name: '管理员', level: 90 },
  },
  {
    id: 2,
    username: 'normal',
    email: 'normal@example.com',
    status: 'active',
    isSuperAdmin: false,
    role: { code: 'qi_refining', name: '练气', level: 10 },
  },
] as const;

function createPrismaMock() {
  const backgrounds: StoredBackground[] = [];
  const withUploader = (background: StoredBackground) => ({
    ...background,
    uploadedBy: {
      id: background.uploadedById,
      username: users.find((user) => user.id === background.uploadedById)?.username ?? 'unknown',
    },
  });
  const backgroundImage = {
    create: jest.fn(
      async ({ data }: { data: Omit<StoredBackground, 'id' | 'isActive' | 'createdAt' | 'updatedAt'> }) => {
        const now = new Date();
        const background: StoredBackground = {
          id: backgrounds.length + 1,
          ...data,
          isActive: false,
          createdAt: now,
          updatedAt: now,
        };
        backgrounds.push(background);
        return withUploader(background);
      },
    ),
    delete: jest.fn(async ({ where }: { where: { id: number } }) => {
      const index = backgrounds.findIndex((background) => background.id === where.id);
      if (index < 0) {
        throw new Error('Background not found');
      }
      return backgrounds.splice(index, 1)[0];
    }),
    findFirst: jest.fn(
      async ({ where }: { where?: { isActive?: boolean } } = {}) => {
        const background = backgrounds.find((item) => where?.isActive === undefined || item.isActive === where.isActive);
        return background ? withUploader(background) : null;
      },
    ),
    findMany: jest.fn(async () => {
      return [...backgrounds]
        .sort((left, right) => Number(right.isActive) - Number(left.isActive) || right.createdAt.getTime() - left.createdAt.getTime())
        .map(withUploader);
    }),
    findUnique: jest.fn(async ({ where }: { where: { id?: number; storedName?: string } }) => {
      const background = backgrounds.find(
        (item) =>
          (where.id !== undefined && item.id === where.id) ||
          (where.storedName !== undefined && item.storedName === where.storedName),
      );
      return background ? withUploader(background) : null;
    }),
    update: jest.fn(async ({ where, data }: { where: { id: number }; data: Partial<StoredBackground> }) => {
      const background = backgrounds.find((item) => item.id === where.id);
      if (!background) {
        throw new Error('Background not found');
      }
      Object.assign(background, data, { updatedAt: new Date() });
      return withUploader(background);
    }),
    updateMany: jest.fn(async ({ where, data }: { where: { isActive?: boolean }; data: Partial<StoredBackground> }) => {
      let count = 0;
      for (const background of backgrounds) {
        if (where.isActive === undefined || background.isActive === where.isActive) {
          Object.assign(background, data, { updatedAt: new Date() });
          count += 1;
        }
      }
      return { count };
    }),
  };
  const prisma = {
    backgroundImage,
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: number } }) => {
        return users.find((user) => user.id === where.id) ?? null;
      }),
    },
    $transaction: jest.fn(async (callback: (transaction: { backgroundImage: typeof backgroundImage }) => unknown) => {
      return callback({ backgroundImage });
    }),
  };

  return { backgrounds, prisma };
}

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('background image management (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let uploadDirectory: string;
  let state: ReturnType<typeof createPrismaMock>;

  beforeEach(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access-token-secret';
    process.env.JWT_ACCESS_EXPIRES_IN = '15m';
    uploadDirectory = await mkdtemp(join(tmpdir(), 'hlovet-backgrounds-'));
    process.env.BACKGROUND_UPLOAD_DIR = uploadDirectory;
    state = createPrismaMock();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(state.prisma)
      .overrideProvider(RedisService)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterEach(async () => {
    await app?.close();
    await rm(uploadDirectory, { recursive: true, force: true });
    delete process.env.BACKGROUND_UPLOAD_DIR;
  });

  async function tokenFor(userId: number): Promise<string> {
    const user = users.find((item) => item.id === userId);
    if (!user) {
      throw new Error(`Missing user ${userId}`);
    }
    return jwt.signAsync(
      { sub: user.id, username: user.username },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' },
    );
  }

  it('returns no active upload before an administrator selects one', async () => {
    const response = await request(app.getHttpServer()).get('/backgrounds/active').expect(200);
    expect(response.body).toEqual({ background: null });
  });

  it('rejects background management for regular users', async () => {
    const token = await tokenFor(2);
    await request(app.getHttpServer()).get('/backgrounds').set('Authorization', `Bearer ${token}`).expect(403);
    await request(app.getHttpServer())
      .post('/backgrounds')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', onePixelPng, { filename: 'background.png', contentType: 'image/png' })
      .expect(403);
  });

  it('rejects files whose declared image type does not match their content', async () => {
    const token = await tokenFor(1);
    await request(app.getHttpServer())
      .post('/backgrounds')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('not-an-image'), { filename: 'background.png', contentType: 'image/png' })
      .expect(400);
    expect(state.backgrounds).toHaveLength(0);
  });

  it('uploads, serves, activates, and physically deletes managed backgrounds', async () => {
    const token = await tokenFor(1);
    const uploadResponse = await request(app.getHttpServer())
      .post('/backgrounds')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', onePixelPng, { filename: 'first.png', contentType: 'image/png' })
      .attach('files', onePixelPng, { filename: 'second.png', contentType: 'image/png' })
      .expect(201);
    const [firstUpload, secondUpload] = uploadResponse.body;

    expect(uploadResponse.body).toHaveLength(2);
    expect(firstUpload.url).toMatch(/^\/backgrounds\/files\/[0-9a-f-]{36}\.png$/);
    const firstStoredName = String(firstUpload.url).split('/').at(-1);
    expect(await readFile(join(uploadDirectory, firstStoredName as string))).toEqual(onePixelPng);

    await request(app.getHttpServer())
      .patch(`/backgrounds/${firstUpload.id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/backgrounds/${secondUpload.id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(state.backgrounds.filter((background) => background.isActive)).toHaveLength(1);
    expect(state.backgrounds.find((background) => background.isActive)?.id).toBe(secondUpload.id);

    const activeResponse = await request(app.getHttpServer()).get('/backgrounds/active').expect(200);
    expect(activeResponse.body.background.id).toBe(secondUpload.id);

    await request(app.getHttpServer()).get(firstUpload.url).expect(200).expect('Content-Type', /image\/png/);
    await request(app.getHttpServer())
      .delete(`/backgrounds/${secondUpload.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(state.backgrounds.some((background) => background.id === secondUpload.id)).toBe(false);
    await expect(readFile(join(uploadDirectory, String(secondUpload.url).split('/').at(-1) as string))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await request(app.getHttpServer()).get('/backgrounds/active').expect(200, { background: null });
  });
});
