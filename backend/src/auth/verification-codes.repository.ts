import { Injectable } from '@nestjs/common';
import { VerificationCode, VerificationPurpose } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class VerificationCodesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Tạo mã mới và vô hiệu hoá mọi mã cũ chưa dùng cùng mục đích (chỉ mã MỚI NHẤT có hiệu lực). */
  async replace(data: {
    userId: string;
    purpose: VerificationPurpose;
    codeHash: string;
    expiresAt: Date;
  }): Promise<VerificationCode> {
    return this.prisma.$transaction(async (tx) => {
      await tx.verificationCode.updateMany({
        where: { userId: data.userId, purpose: data.purpose, usedAt: null },
        data: { usedAt: new Date() },
      });
      return tx.verificationCode.create({ data });
    });
  }

  findActive(
    userId: string,
    purpose: VerificationPurpose,
  ): Promise<VerificationCode | null> {
    return this.prisma.verificationCode.findFirst({
      where: { userId, purpose, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Tăng số lần nhập sai; đạt `maxAttempts` → mã bị vô hiệu hoá. Trả về số lần sai mới. */
  async registerFailedAttempt(
    id: string,
    maxAttempts: number,
  ): Promise<number> {
    const updated = await this.prisma.verificationCode.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
    if (updated.attempts >= maxAttempts) {
      await this.markUsed(id);
    }
    return updated.attempts;
  }

  /**
   * Đánh dấu đã dùng — có điều kiện `usedAt: null` để 2 request cùng mã chạy song song
   * thì chỉ 1 request thắng (count = 1).
   */
  async markUsed(id: string): Promise<boolean> {
    const { count } = await this.prisma.verificationCode.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }
}
