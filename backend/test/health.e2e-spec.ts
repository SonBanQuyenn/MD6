import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp } from './utils';

/**
 * Integration test: chạy với PostgreSQL và Redis THẬT
 * (docker compose ở máy local, service containers trong CI).
 */
describe('Health (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health → 200 không cần đăng nhập, database và redis đều up', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.info).toEqual({
      database: { status: 'up' },
      redis: { status: 'up' },
    });
  });

  it('GET /api/health/live → 200', async () => {
    const res = await request(app.getHttpServer()).get('/api/health/live');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
