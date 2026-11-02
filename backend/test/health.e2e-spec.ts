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

  it('GET /api/health/ready → 200 khi database up', async () => {
    const res = await request(app.getHttpServer()).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.info).toEqual({ database: { status: 'up' } });
  });

  it('health check không bị rate limit (Docker gọi liên tục)', async () => {
    const res = await request(app.getHttpServer()).get('/api/health/live');
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('GET /api/docs-json → tài liệu OpenAPI có đủ các nhóm API chính (F07.3)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.components.securitySchemes.bearer).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    const paths = Object.keys(res.body.paths);
    for (const path of [
      '/api/auth/login',
      '/api/products',
      '/api/orders',
      '/api/support/tickets/{id}/assistant',
      '/api/admin/queues',
      '/api/health',
    ]) {
      expect(paths).toContain(path);
    }
  });

  it('GET /api/docs → giao diện Swagger UI', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/docs')
      .redirects(1);
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger');
  });
});
