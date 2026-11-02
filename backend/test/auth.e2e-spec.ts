import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, getRefreshCookie, resetDatabase } from './utils';

describe('Auth (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  const newCustomer = {
    email: 'Khach.Moi@Example.com ',
    password: 'Matkhau123',
    fullName: 'Khách Mới',
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/auth/register', () => {
    it('201: tạo CUSTOMER, trả access token, đặt refresh cookie an toàn', async () => {
      const res = await http()
        .post('/api/auth/register')
        .send(newCustomer)
        .expect(201);

      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user).toMatchObject({
        email: 'khach.moi@example.com', // đã chuẩn hoá: trim + chữ thường
        role: 'CUSTOMER',
      });
      expect(res.body.user).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('refreshToken');

      const cookie = (res.headers['set-cookie'] as unknown as string[])[0];
      expect(cookie).toMatch(/^sf_refresh=/);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Path=/api/auth');
    });

    it('mật khẩu được lưu dạng bcrypt hash, không phải chữ thường', async () => {
      await http().post('/api/auth/register').send(newCustomer).expect(201);

      const user = await prisma.user.findUniqueOrThrow({
        where: { email: 'khach.moi@example.com' },
      });
      expect(user.passwordHash).not.toContain(newCustomer.password);
      expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
    });

    it('400: không cho tự gán vai trò ADMIN khi đăng ký', async () => {
      const res = await http()
        .post('/api/auth/register')
        .send({ ...newCustomer, role: 'ADMIN' })
        .expect(400);

      expect(JSON.stringify(res.body.message)).toContain('role');
      expect(await prisma.user.count()).toBe(0);
    });

    it('400: email sai và mật khẩu yếu → thông báo tiếng Việt', async () => {
      const res = await http()
        .post('/api/auth/register')
        .send({ email: 'khong-phai-email', password: 'abc', fullName: 'A' })
        .expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([
          'Email không hợp lệ',
          'Mật khẩu phải có ít nhất 8 ký tự',
          'Họ tên phải có ít nhất 2 ký tự',
        ]),
      );
    });

    it('409: email đã được sử dụng', async () => {
      await http().post('/api/auth/register').send(newCustomer).expect(201);

      const res = await http()
        .post('/api/auth/register')
        .send(newCustomer)
        .expect(409);
      expect(res.body.message).toBe('Email đã được sử dụng');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await http().post('/api/auth/register').send(newCustomer).expect(201);
    });

    it('200 với email (không phân biệt hoa thường) và mật khẩu đúng', async () => {
      const res = await http()
        .post('/api/auth/login')
        .send({ email: 'KHACH.MOI@example.com', password: 'Matkhau123' })
        .expect(200);

      expect(res.body.accessToken).toEqual(expect.any(String));
    });

    it('401 với mật khẩu sai — thông báo không tiết lộ email có tồn tại', async () => {
      const wrongPassword = await http()
        .post('/api/auth/login')
        .send({ email: 'khach.moi@example.com', password: 'SaiMatKhau9' })
        .expect(401);
      const unknownEmail = await http()
        .post('/api/auth/login')
        .send({ email: 'khongco@example.com', password: 'Matkhau123' })
        .expect(401);

      expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
    });
  });

  describe('Protected route & refresh token', () => {
    it('GET /api/users/me: 401 khi không có token, 200 khi có token', async () => {
      const reg = await http()
        .post('/api/auth/register')
        .send(newCustomer)
        .expect(201);

      await http().get('/api/users/me').expect(401);
      await http()
        .get('/api/users/me')
        .set('Authorization', 'Bearer token.gia.mao')
        .expect(401);

      const me = await http()
        .get('/api/users/me')
        .set('Authorization', `Bearer ${reg.body.accessToken}`)
        .expect(200);
      expect(me.body.email).toBe('khach.moi@example.com');
    });

    it('refresh xoay vòng token; dùng lại token cũ → thu hồi toàn bộ phiên', async () => {
      const reg = await http()
        .post('/api/auth/register')
        .send(newCustomer)
        .expect(201);
      const firstCookie = getRefreshCookie(reg);

      // Lần 1: hợp lệ → nhận access token + cookie MỚI
      const refreshed = await http()
        .post('/api/auth/refresh')
        .set('Cookie', firstCookie)
        .expect(200);
      const secondCookie = getRefreshCookie(refreshed);
      expect(secondCookie).not.toBe(firstCookie);
      expect(refreshed.body.accessToken).toEqual(expect.any(String));

      // Kẻ gian dùng lại cookie cũ → 401
      await http()
        .post('/api/auth/refresh')
        .set('Cookie', firstCookie)
        .expect(401);

      // ...và cookie mới của người dùng thật cũng bị thu hồi theo (an toàn hơn)
      await http()
        .post('/api/auth/refresh')
        .set('Cookie', secondCookie)
        .expect(401);
    });

    it('refresh không có cookie → 401', async () => {
      await http().post('/api/auth/refresh').expect(401);
    });

    it('logout → 204, sau đó refresh bằng cookie cũ → 401', async () => {
      const reg = await http()
        .post('/api/auth/register')
        .send(newCustomer)
        .expect(201);
      const cookie = getRefreshCookie(reg);

      await http().post('/api/auth/logout').set('Cookie', cookie).expect(204);
      await http().post('/api/auth/refresh').set('Cookie', cookie).expect(401);
    });
  });
});
