import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { LightweightMonitoringService } from '../src/system-status/lightweight-monitoring.service';

describe('HealthController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn(),
        $disconnect: jest.fn(),
        $queryRawUnsafe: jest.fn().mockResolvedValue([{ value: 1 }]),
      })
      .overrideProvider(RedisService)
      .useValue({ ping: jest.fn().mockResolvedValue('PONG') })
      .overrideProvider(LightweightMonitoringService)
      .useValue({ recordHttpRequest: jest.fn(), recordClientError: jest.fn() })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns service status', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({
        status: 'ok',
        service: 'lingxi-api',
      });
  });

  it('GET /health/ready checks database and Redis dependencies', async () => {
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'ok', checks: { database: { ok: true }, redis: { ok: true } } }));
  });

  it('POST /health/client-errors accepts bounded client diagnostics', async () => {
    await request(app.getHttpServer())
      .post('/health/client-errors')
      .send({ source: 'window-error', message: 'render failed', path: '/articles/test', stack: 'Error: render failed', buildId: 'build-test' })
      .expect(202)
      .expect({ accepted: true });
  });
});
