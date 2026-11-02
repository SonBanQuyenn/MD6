import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, loginAs, resetDatabase } from './utils';

/**
 * Integration test F03 — rate limit chạy trên Redis THẬT.
 * Redis được FLUSHDB trước mỗi test (setup-each.ts) nên bộ đếm luôn bắt đầu từ 0.
 */
describe('Rate limiting (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

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

  it('đăng nhập: request thứ 6 trong 1 phút từ cùng IP → 429 + Retry-After + tiếng Việt', async () => {
    // Mỗi lần dùng 1 email khác → không chạm ngưỡng khoá theo tài khoản, chỉ test hạn mức IP.
    const login = (email: string, ip = '5.5.5.5') =>
      http()
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email, password: 'Sai12345' });
    for (let i = 0; i < 5; i++) {
      await login(`khong-co-${i}@example.com`).expect(401);
    }
    const res = await login('khong-co-6@example.com').expect(429);
    // IP khác vẫn đăng nhập được → hạn mức tính riêng từng IP.
    await login('khong-co-7@example.com', '6.6.6.6').expect(401);

    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.body.message).toMatch(/thử đăng nhập quá nhiều lần/);
    expect(res.body.retryAfter).toBeGreaterThan(0);
  });

  it('dò mật khẩu: sai 5 lần → khoá tài khoản mục tiêu, kể cả khi đổi IP', async () => {
    const victim = await createUser(
      prisma,
      Role.CUSTOMER,
      'nan-nhan@example.com',
    );
    const attempt = (ip: string, password: string) =>
      http()
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip) // test bật TRUST_PROXY=1 → mỗi lần là 1 IP khác
        .send({ email: victim.email, password });

    for (let i = 0; i < 4; i++) {
      await attempt(`9.9.9.${i}`, 'SaiMatKhau1').expect(401);
    }
    const locked = await attempt('9.9.9.9', 'SaiMatKhau1').expect(429);
    expect(locked.body.message).toMatch(/tạm thời bị khoá đăng nhập/);

    // Mỗi IP mới chỉ dùng 1 lần → không chạm hạn mức theo IP. Bị chặn là do khoá TÀI KHOẢN:
    // kể cả mật khẩu ĐÚNG từ IP mới vẫn bị từ chối khi tài khoản đang bị khoá.
    await attempt('8.8.8.8', 'Matkhau123').expect(429);
  });

  it('đặt đơn khuyến mãi: 3 lần / phút / tài khoản, lần thứ 4 → 429', async () => {
    const customer = await createUser(prisma, Role.CUSTOMER, 'kh@example.com');
    const { accessToken } = await loginAs(app, customer.email);
    const promo = () =>
      http()
        .post('/api/orders/promotional')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          promotionCode: 'KHONGCO',
          paymentMethod: 'COD',
          shippingAddress: {
            fullName: 'Nguyễn Văn A',
            phone: '0912345678',
            addressLine: '1 Lê Lợi',
            city: 'Hà Nội',
          },
        });

    for (let i = 0; i < 3; i++) {
      const res = await promo();
      expect(res.status).not.toBe(429); // giỏ trống → 400, nhưng vẫn bị đếm
    }
    const blocked = await promo().expect(429);
    expect(blocked.body.message).toMatch(/đặt đơn khuyến mãi quá nhanh/);
  });

  it('gửi mã xác thực: 3 lần / 15 phút, lần thứ 4 → 429', async () => {
    for (let i = 0; i < 3; i++) {
      await http()
        .post('/api/auth/verification-code')
        .send({ email: 'ai-do@example.com', purpose: 'RESET_PASSWORD' })
        .expect(202);
    }
    const res = await http()
      .post('/api/auth/verification-code')
      .send({ email: 'ai-do@example.com', purpose: 'RESET_PASSWORD' })
      .expect(429);
    expect(res.body.retryAfter).toBeGreaterThan(14 * 60);
  });

  it('API thường có header X-RateLimit-Limit / Remaining', async () => {
    const res = await http().get('/api/categories').expect(200);
    expect(Number(res.headers['x-ratelimit-limit'])).toBeGreaterThan(0);
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
  });
});

describe('Verification code flow (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

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

  it('email không tồn tại và tồn tại nhận cùng một phản hồi (không dò được email)', async () => {
    await createUser(prisma, Role.CUSTOMER, 'co-that@example.com');
    const a = await http()
      .post('/api/auth/verification-code')
      .send({ email: 'co-that@example.com', purpose: 'RESET_PASSWORD' })
      .expect(202);
    const b = await http()
      .post('/api/auth/verification-code')
      .send({ email: 'khong-co@example.com', purpose: 'RESET_PASSWORD' })
      .expect(202);
    expect(a.body).toEqual(b.body);
    // Chỉ email có thật mới có mã trong DB — và chỉ ở dạng hash.
    const saved = await prisma.verificationCode.findMany();
    expect(saved).toHaveLength(1);
    expect(saved[0].codeHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('mã sai → 400; yêu cầu mã mới → mã cũ mất hiệu lực', async () => {
    await createUser(prisma, Role.CUSTOMER, 'kh@example.com');
    await http()
      .post('/api/auth/verification-code')
      .send({ email: 'kh@example.com', purpose: 'VERIFY_EMAIL' })
      .expect(202);
    await http()
      .post('/api/auth/verify-email')
      .send({ email: 'kh@example.com', code: '000000' })
      .expect(400);
    await http()
      .post('/api/auth/verification-code')
      .send({ email: 'kh@example.com', purpose: 'VERIFY_EMAIL' })
      .expect(202);
    const codes = await prisma.verificationCode.findMany({
      orderBy: { createdAt: 'asc' },
    });
    expect(codes).toHaveLength(2);
    expect(codes[0].usedAt).not.toBeNull(); // mã cũ bị vô hiệu hoá
    expect(codes[1].usedAt).toBeNull();
  });
});
