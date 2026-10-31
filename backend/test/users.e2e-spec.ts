import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, loginAs, resetDatabase } from './utils';

/** Kiểm tra phân quyền theo vai trò (RBAC) trên các endpoint quản lý người dùng. */
describe('Users & RBAC (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  let adminToken: string;
  let customerId: string;
  let customerEmail: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const admin = await createUser(prisma, Role.ADMIN, 'admin@example.com');
    const customer = await createUser(
      prisma,
      Role.CUSTOMER,
      'customer@example.com',
    );
    customerId = customer.id;
    customerEmail = customer.email;
    adminToken = (await loginAs(app, admin.email)).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([Role.CUSTOMER, Role.SUPPORT_AGENT, Role.WAREHOUSE_STAFF])(
    '%s gọi GET /api/users → 403',
    async (role) => {
      const user = await createUser(prisma, role);
      const { accessToken } = await loginAs(app, user.email);

      const res = await http()
        .get('/api/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
      expect(res.body.message).toBe(
        'Bạn không có quyền thực hiện thao tác này',
      );
    },
  );

  it('ADMIN gọi GET /api/users → 200, có phân trang, không lộ passwordHash', async () => {
    const res = await http()
      .get('/api/users?page=1&limit=1')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toMatchObject({ page: 1, limit: 1, total: 2 });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).not.toHaveProperty('passwordHash');
  });

  it('400 khi limit vượt quá 50', async () => {
    await http()
      .get('/api/users?limit=500')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('ADMIN đổi vai trò người dùng; giá trị vai trò sai → 400; id sai định dạng → 400', async () => {
    const ok = await http()
      .patch(`/api/users/${customerId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'WAREHOUSE_STAFF' })
      .expect(200);
    expect(ok.body.role).toBe('WAREHOUSE_STAFF');

    await http()
      .patch(`/api/users/${customerId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'SUPER_ADMIN' })
      .expect(400);

    await http()
      .patch('/api/users/khong-phai-uuid/role')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'ADMIN' })
      .expect(400);
  });

  it('ADMIN khoá tài khoản → người đó không đăng nhập và không refresh được nữa', async () => {
    const { refreshCookie } = await loginAs(app, customerEmail);

    await http()
      .patch(`/api/users/${customerId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false })
      .expect(200);

    await http()
      .post('/api/auth/login')
      .send({ email: customerEmail, password: 'Matkhau123' })
      .expect(403);
    await http()
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(401);
  });

  it('CUSTOMER không thể tự nâng quyền mình lên ADMIN', async () => {
    const { accessToken } = await loginAs(app, customerEmail);

    await http()
      .patch(`/api/users/${customerId}/role`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'ADMIN' })
      .expect(403);
  });
});
