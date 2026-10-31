/**
 * Seed dữ liệu mẫu cho môi trường DEV/DEMO (SRS: "dữ liệu ban đầu nạp sẵn bằng script seed").
 * Chạy: npx prisma db seed
 *
 * Chạy lại nhiều lần vẫn an toàn (dùng upsert theo email).
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ACCOUNTS: { email: string; fullName: string; role: Role }[] = [
  {
    email: 'admin@shopfast.local',
    fullName: 'Quản trị viên',
    role: Role.ADMIN,
  },
  {
    email: 'support@shopfast.local',
    fullName: 'Nhân viên CSKH',
    role: Role.SUPPORT_AGENT,
  },
  {
    email: 'warehouse@shopfast.local',
    fullName: 'Nhân viên kho',
    role: Role.WAREHOUSE_STAFF,
  },
  {
    email: 'customer@shopfast.local',
    fullName: 'Nguyễn Văn Khách',
    role: Role.CUSTOMER,
  },
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Không chạy seed tài khoản mẫu trên production.');
  }
  const password = process.env.SEED_PASSWORD;
  if (!password) {
    throw new Error('Thiếu biến môi trường SEED_PASSWORD (xem .env.example).');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  for (const account of ACCOUNTS) {
    await prisma.user.upsert({
      where: { email: account.email },
      update: { role: account.role, fullName: account.fullName },
      create: { ...account, passwordHash, emailVerified: true },
    });
    console.log(`✔ ${account.role.padEnd(16)} ${account.email}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
