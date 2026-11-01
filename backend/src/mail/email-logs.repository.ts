import { Injectable } from '@nestjs/common';
import { EmailLog, EmailStatus } from '@prisma/client';
import { isPrismaError } from '../common/utils/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';

/** Bản ghi SENDING lâu hơn mức này → coi như worker trước đã chết giữa chừng. */
export const SENDING_STALE_MS = 2 * 60 * 1000;

@Injectable()
export class EmailLogsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Giành QUYỀN GỬI một email theo dedupeKey. `acquired = true` nghĩa là CHỈ worker này
   * được gửi. Các trường hợp:
   *  - Chưa có bản ghi → tạo mới (UNIQUE đảm bảo chỉ 1 worker tạo được) → acquired.
   *  - Đã có, trạng thái FAILED, hoặc SENDING nhưng "treo" quá 2 phút → chiếm lại bằng
   *    UPDATE có điều kiện (chỉ 1 worker cập nhật được dòng đó) → acquired.
   *  - Đã có, SENT hoặc đang SENDING bởi worker khác → không được gửi.
   */
  async claim(data: {
    dedupeKey: string;
    type: string;
    orderId?: string;
    toEmail: string;
    subject: string;
  }): Promise<{ log: EmailLog; acquired: boolean }> {
    try {
      const log = await this.prisma.emailLog.create({
        data: { ...data, status: EmailStatus.SENDING, attempts: 1 },
      });
      return { log, acquired: true };
    } catch (error) {
      if (!isPrismaError(error, 'P2002')) throw error;
    }

    const { count } = await this.prisma.emailLog.updateMany({
      where: {
        dedupeKey: data.dedupeKey,
        OR: [
          { status: EmailStatus.FAILED },
          {
            status: EmailStatus.SENDING,
            updatedAt: { lt: new Date(Date.now() - SENDING_STALE_MS) },
          },
        ],
      },
      data: { status: EmailStatus.SENDING, attempts: { increment: 1 } },
    });
    const log = await this.prisma.emailLog.findUniqueOrThrow({
      where: { dedupeKey: data.dedupeKey },
    });
    return { log, acquired: count === 1 };
  }

  markSent(id: string, providerMessageId: string): Promise<EmailLog> {
    return this.prisma.emailLog.update({
      where: { id },
      data: {
        status: EmailStatus.SENT,
        providerMessageId,
        sentAt: new Date(),
        lastError: null,
      },
    });
  }

  markFailed(id: string, error: string): Promise<EmailLog> {
    return this.prisma.emailLog.update({
      where: { id },
      data: { status: EmailStatus.FAILED, lastError: error.slice(0, 1000) },
    });
  }
}
