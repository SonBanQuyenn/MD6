import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VerificationPurpose } from '@prisma/client';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { JobsProducer } from '../jobs/jobs.producer';
import { UsersRepository } from '../users/users.repository';
import { PasswordService } from './password.service';
import { RefreshTokensRepository } from './refresh-tokens.repository';
import { VerificationCodesRepository } from './verification-codes.repository';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
const INVALID_CODE = 'Mã xác thực không đúng hoặc đã hết hạn';

/**
 * Mã xác thực 6 số (OTP) — TD-12. Dùng để xác minh email và đặt lại mật khẩu.
 *  - Chỉ lưu HMAC của mã (lộ DB cũng không đọc được mã).
 *  - Hết hạn 10 phút, sai 5 lần → mã bị huỷ (6 chữ số = 1 triệu khả năng, 5 lần đoán ≈ 0,0005%).
 *  - Endpoint gửi mã bị giới hạn 3 lần / 15 phút (F03.1).
 *  - Luôn trả cùng một thông báo dù email có tồn tại hay không → không dò được email.
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);
  private readonly secret: string;

  constructor(
    private readonly codes: VerificationCodesRepository,
    private readonly users: UsersRepository,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokensRepository,
    private readonly jobs: JobsProducer,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  async requestCode(email: string, purpose: VerificationPurpose) {
    const user = await this.users.findByEmail(email);
    const skip =
      !user ||
      !user.isActive ||
      (purpose === VerificationPurpose.VERIFY_EMAIL && user.emailVerified);
    if (!skip) {
      const code = generateCode();
      const saved = await this.codes.replace({
        userId: user.id,
        purpose,
        codeHash: this.hash(code),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      });
      // Gửi email qua hàng đợi (F05) — không bắt khách chờ SMTP.
      await this.jobs.verificationCode({ codeId: saved.id, code, purpose });
    }
    return {
      message:
        'Nếu email hợp lệ, mã xác thực đã được gửi. Mã có hiệu lực trong 10 phút.',
    };
  }

  async verifyEmail(email: string, code: string) {
    const userId = await this.consume(
      email,
      VerificationPurpose.VERIFY_EMAIL,
      code,
    );
    await this.users.update(userId, { emailVerified: true });
    return { message: 'Xác minh email thành công' };
  }

  async resetPassword(email: string, code: string, newPassword: string) {
    const userId = await this.consume(
      email,
      VerificationPurpose.RESET_PASSWORD,
      code,
    );
    await this.users.update(userId, {
      passwordHash: await this.passwords.hash(newPassword),
    });
    // Đổi mật khẩu → đăng xuất mọi thiết bị (phòng trường hợp mật khẩu cũ đã bị lộ).
    await this.refreshTokens.revokeAllForUser(userId);
    return { message: 'Đặt lại mật khẩu thành công, vui lòng đăng nhập lại' };
  }

  /** Kiểm tra mã; đúng → đánh dấu đã dùng và trả về userId. */
  private async consume(
    email: string,
    purpose: VerificationPurpose,
    code: string,
  ): Promise<string> {
    const user = await this.users.findByEmail(email);
    const record = user ? await this.codes.findActive(user.id, purpose) : null;
    if (!user || !record || record.expiresAt <= new Date()) {
      throw new BadRequestException(INVALID_CODE);
    }

    if (!safeEqual(record.codeHash, this.hash(code))) {
      const attempts = await this.codes.registerFailedAttempt(
        record.id,
        MAX_ATTEMPTS,
      );
      if (attempts >= MAX_ATTEMPTS) {
        this.logger.warn(`Mã ${record.id} bị huỷ sau ${attempts} lần nhập sai`);
        throw new BadRequestException(
          'Bạn đã nhập sai quá nhiều lần, vui lòng yêu cầu mã mới',
        );
      }
      throw new BadRequestException(INVALID_CODE);
    }

    // 2 request cùng mã cùng lúc → chỉ 1 request dùng được mã.
    if (!(await this.codes.markUsed(record.id))) {
      throw new BadRequestException(INVALID_CODE);
    }
    return user.id;
  }

  private hash(code: string): string {
    return createHmac('sha256', this.secret).update(code).digest('hex');
  }
}

/** 6 chữ số ngẫu nhiên an toàn (crypto.randomInt, không dùng Math.random). */
export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
