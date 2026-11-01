import { Injectable, Logger } from '@nestjs/common';
import { EmailStatus } from '@prisma/client';
import { EmailLogsRepository } from './email-logs.repository';
import { MailerService } from './mailer.service';

export interface SendOnceInput {
  /** Khoá chống trùng, ví dụ `order-confirmation-<orderId>` */
  dedupeKey: string;
  type: string;
  orderId?: string;
  to: string;
  subject: string;
  html: string;
}

export type SendOnceResult = 'sent' | 'already-sent';

/**
 * Gửi email ĐÚNG 1 LẦN cho mỗi dedupeKey (yêu cầu F05.3).
 *
 *  1. Giành quyền gửi qua email_logs (dedupeKey UNIQUE + UPDATE có điều kiện).
 *  2. Đã SENT → bỏ qua, KHÔNG gửi lại (job chạy lại / bị thêm 2 lần).
 *     Worker khác đang gửi → ném lỗi để BullMQ thử lại sau (lúc đó sẽ thấy SENT).
 *  3. Gửi SMTP → đánh dấu SENT. Lỗi → đánh dấu FAILED rồi ném lỗi để BullMQ retry.
 *
 * Giới hạn còn lại (ghi trong technical-decisions): nếu tiến trình chết ĐÚNG sau khi SMTP
 * nhận thư nhưng trước khi kịp ghi SENT, lần retry sẽ gửi lại. Message-ID cố định giúp
 * nhiều hộp thư tự gộp thư trùng trong trường hợp hiếm này.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly logs: EmailLogsRepository,
    private readonly mailer: MailerService,
  ) {}

  async sendOnce(input: SendOnceInput): Promise<SendOnceResult> {
    const { log, acquired } = await this.logs.claim({
      dedupeKey: input.dedupeKey,
      type: input.type,
      orderId: input.orderId,
      toEmail: input.to,
      subject: input.subject,
    });

    if (log.status === EmailStatus.SENT) {
      this.logger.log(`Bỏ qua ${input.dedupeKey}: email đã được gửi trước đó`);
      return 'already-sent';
    }
    if (!acquired) {
      throw new Error(
        `Email ${input.dedupeKey} đang được worker khác gửi — sẽ kiểm tra lại ở lần thử sau`,
      );
    }

    try {
      const { messageId } = await this.mailer.send({
        to: input.to,
        subject: input.subject,
        html: input.html,
        messageId: `<${input.dedupeKey}@shopfast.local>`,
      });
      await this.logs.markSent(log.id, messageId);
      return 'sent';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.logs.markFailed(log.id, message);
      throw error; // để BullMQ thử lại theo cấu hình backoff
    }
  }
}
