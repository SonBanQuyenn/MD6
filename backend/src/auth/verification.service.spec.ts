import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, User, VerificationCode } from '@prisma/client';
import { createHmac } from 'crypto';
import { JobsProducer } from '../jobs/jobs.producer';
import { UsersRepository } from '../users/users.repository';
import { PasswordService } from './password.service';
import { RefreshTokensRepository } from './refresh-tokens.repository';
import { VerificationCodesRepository } from './verification-codes.repository';
import {
  generateCode,
  MAX_ATTEMPTS,
  VerificationService,
} from './verification.service';

const SECRET = 'unit-test-secret-unit-test-secret-1234';
const hmac = (code: string) =>
  createHmac('sha256', SECRET).update(code).digest('hex');

const user: User = {
  id: 'user-1',
  email: 'khach@example.com',
  passwordHash: 'x',
  fullName: 'Khách',
  role: Role.CUSTOMER,
  emailVerified: false,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const record = (
  overrides: Partial<VerificationCode> = {},
): VerificationCode => ({
  id: 'code-1',
  userId: user.id,
  purpose: 'VERIFY_EMAIL',
  codeHash: hmac('123456'),
  attempts: 0,
  expiresAt: new Date(Date.now() + 60_000),
  usedAt: null,
  createdAt: new Date(),
  ...overrides,
});

describe('VerificationService', () => {
  let codes: jest.Mocked<
    Pick<
      VerificationCodesRepository,
      'replace' | 'findActive' | 'registerFailedAttempt' | 'markUsed'
    >
  >;
  let users: jest.Mocked<Pick<UsersRepository, 'findByEmail' | 'update'>>;
  let jobs: { verificationCode: jest.Mock };
  let refreshTokens: { revokeAllForUser: jest.Mock };
  let service: VerificationService;

  beforeEach(() => {
    codes = {
      replace: jest.fn(async (data) => record({ ...data, id: 'code-new' })),
      findActive: jest.fn(),
      registerFailedAttempt: jest.fn(),
      markUsed: jest.fn().mockResolvedValue(true),
    };
    users = {
      findByEmail: jest.fn().mockResolvedValue(user),
      update: jest.fn(),
    };
    jobs = { verificationCode: jest.fn() };
    refreshTokens = { revokeAllForUser: jest.fn() };
    service = new VerificationService(
      codes as unknown as VerificationCodesRepository,
      users as unknown as UsersRepository,
      { hash: async (p: string) => `hashed:${p}` } as PasswordService,
      refreshTokens as unknown as RefreshTokensRepository,
      jobs as unknown as JobsProducer,
      { getOrThrow: () => SECRET } as unknown as ConfigService,
    );
  });

  it('generateCode luôn trả 6 chữ số', () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it('gửi mã: chỉ lưu HMAC, mã gốc đi vào job email', async () => {
    await service.requestCode(user.email, 'VERIFY_EMAIL');
    const saved = codes.replace.mock.calls[0][0];
    const job = jobs.verificationCode.mock.calls[0][0];
    expect(job.code).toMatch(/^\d{6}$/);
    expect(saved.codeHash).toBe(hmac(job.code));
    expect(saved.codeHash).not.toContain(job.code);
  });

  it('email không tồn tại → vẫn trả cùng thông báo nhưng không gửi gì', async () => {
    users.findByEmail.mockResolvedValue(null);
    const result = await service.requestCode('ai@x.com', 'RESET_PASSWORD');
    expect(result.message).toMatch(/Nếu email hợp lệ/);
    expect(jobs.verificationCode).not.toHaveBeenCalled();
  });

  it('email đã xác minh → không gửi mã VERIFY_EMAIL nữa', async () => {
    users.findByEmail.mockResolvedValue({ ...user, emailVerified: true });
    await service.requestCode(user.email, 'VERIFY_EMAIL');
    expect(jobs.verificationCode).not.toHaveBeenCalled();
  });

  it('mã đúng → xác minh email', async () => {
    codes.findActive.mockResolvedValue(record());
    await service.verifyEmail(user.email, '123456');
    expect(codes.markUsed).toHaveBeenCalledWith('code-1');
    expect(users.update).toHaveBeenCalledWith(user.id, {
      emailVerified: true,
    });
  });

  it('mã sai → tăng số lần sai, báo lỗi chung', async () => {
    codes.findActive.mockResolvedValue(record());
    codes.registerFailedAttempt.mockResolvedValue(1);
    await expect(service.verifyEmail(user.email, '000000')).rejects.toThrow(
      'Mã xác thực không đúng hoặc đã hết hạn',
    );
    expect(users.update).not.toHaveBeenCalled();
  });

  it(`sai lần thứ ${MAX_ATTEMPTS} → huỷ mã, yêu cầu mã mới`, async () => {
    codes.findActive.mockResolvedValue(record({ attempts: MAX_ATTEMPTS - 1 }));
    codes.registerFailedAttempt.mockResolvedValue(MAX_ATTEMPTS);
    await expect(service.verifyEmail(user.email, '000000')).rejects.toThrow(
      /yêu cầu mã mới/,
    );
  });

  it('mã hết hạn → từ chối', async () => {
    codes.findActive.mockResolvedValue(
      record({ expiresAt: new Date(Date.now() - 1) }),
    );
    await expect(
      service.verifyEmail(user.email, '123456'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('2 request cùng mã → request thua markUsed bị từ chối', async () => {
    codes.findActive.mockResolvedValue(record());
    codes.markUsed.mockResolvedValue(false);
    await expect(
      service.verifyEmail(user.email, '123456'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('đặt lại mật khẩu → đổi hash và đăng xuất mọi thiết bị', async () => {
    codes.findActive.mockResolvedValue(record({ purpose: 'RESET_PASSWORD' }));
    await service.resetPassword(user.email, '123456', 'Matkhaumoi1');
    expect(users.update).toHaveBeenCalledWith(user.id, {
      passwordHash: 'hashed:Matkhaumoi1',
    });
    expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith(user.id);
  });
});
