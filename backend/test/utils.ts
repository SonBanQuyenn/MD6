import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  return app;
}

/**
 * Xoá sạch dữ liệu mọi bảng (giữ bảng migration).
 * Có chốt an toàn: chỉ chạy trên database có tên kết thúc bằng "_test".
 */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const [{ db }] = await prisma.$queryRaw<
    { db: string }[]
  >`SELECT current_database() AS db`;
  if (!db.endsWith('_test')) {
    throw new Error(`Từ chối xoá dữ liệu database "${db}" (không phải _test)`);
  }
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}

export const TEST_PASSWORD = 'Matkhau123';

/** Tạo thẳng user trong DB (dùng cho vai trò nhân viên — không đăng ký qua API được). */
export async function createUser(
  prisma: PrismaService,
  role: Role,
  email = `${role.toLowerCase()}-${Date.now()}@example.com`,
) {
  return prisma.user.create({
    data: {
      email,
      fullName: `Test ${role}`,
      role,
      passwordHash: await bcrypt.hash(TEST_PASSWORD, 4),
    },
  });
}

export async function loginAs(
  app: INestApplication,
  email: string,
  password = TEST_PASSWORD,
): Promise<{ accessToken: string; refreshCookie: string }> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    // Mỗi lần đăng nhập giả lập 1 IP riêng (mỗi khách thật một IP) → không chạm hạn mức
    // 5 lần / phút / IP của F03 khi test tạo nhiều tài khoản. Test hạn mức: rate-limit.e2e-spec.ts
    .set('X-Forwarded-For', randomIp())
    .send({ email, password })
    .expect(200);
  return {
    accessToken: res.body.accessToken,
    refreshCookie: getRefreshCookie(res),
  };
}

let ipCounter = 0;
/** IP giả lập 10.x.y.z, mỗi lần gọi một IP khác. */
export function randomIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

/** Lấy cặp "sf_refresh=<giá trị>" từ header Set-Cookie để gửi lại ở request sau. */
export function getRefreshCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith('sf_refresh='));
  if (!cookie) throw new Error('Không có cookie sf_refresh trong phản hồi');
  return cookie.split(';')[0];
}
