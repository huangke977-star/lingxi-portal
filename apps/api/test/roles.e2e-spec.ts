import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const cultivationRoles = [
  { code: 'qi_refining', name: '练气', level: 10 },
  { code: 'foundation_building', name: '筑基', level: 20 },
  { code: 'golden_core', name: '金丹', level: 30 },
  { code: 'nascent_soul', name: '元婴', level: 40 },
  { code: 'spirit_transformation', name: '化神', level: 50 },
  { code: 'void_refining', name: '炼虚', level: 60 },
  { code: 'body_integration', name: '合体', level: 70 },
  { code: 'mahayana', name: '大乘', level: 80 },
  { code: 'administrator', name: '管理员', level: 90 },
];

describe('RolesController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        role: {
          findMany: jest.fn().mockResolvedValue(cultivationRoles),
        },
        $connect: jest.fn(),
        $disconnect: jest.fn(),
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /roles returns seeded cultivation roles', async () => {
    const response = await request(app.getHttpServer()).get('/roles').expect(200);

    expect(response.body).toEqual(cultivationRoles);
  });
});
