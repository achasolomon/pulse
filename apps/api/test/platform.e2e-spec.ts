import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { HttpProblemFilter } from './../src/platform/common/filters/http-problem.filter.js';

describe('Platform (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpProblemFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/api/v1 (GET) hello', () => {
    return request(app.getHttpServer()).get('/api/v1').expect(200);
  });

  it('/api/v1/health/live (GET) ok + correlation header', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-correlation-id']).toBeDefined();
  });

  it('/api/v1/health/ready (GET) ok', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(200)
      .expect((res: { body: { status: string } }) => {
        if (res.body.status !== 'ok') throw new Error('not ready');
      });
  });

  it('unknown route returns ProblemDetails', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/nope-missing')
      .expect(404);
    expect(res.body.title).toBeDefined();
    expect(res.body.status).toBe(404);
    expect(res.body.instance).toBeDefined();
  });
});
