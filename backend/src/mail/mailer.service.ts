import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  /** Message-ID cố định theo nghiệp vụ → nhiều hệ thống mail tự gộp thư trùng. */
  messageId?: string;
}

/**
 * Gửi email qua SMTP (nodemailer).
 * Dev/demo: SMTP trỏ tới Mailpit (docker-compose) — thư KHÔNG ra Internet,
 * xem tại http://localhost:8025. Production: đổi SMTP_* sang nhà cung cấp thật.
 */
@Injectable()
export class MailerService {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    const user = config.get<string>('SMTP_USER');
    this.transporter = createTransport({
      host: config.get<string>('SMTP_HOST', '127.0.0.1'),
      port: config.get<number>('SMTP_PORT', 1025),
      secure: config.get<boolean>('SMTP_SECURE', false),
      auth: user ? { user, pass: config.get<string>('SMTP_PASS') } : undefined,
      connectionTimeout: 10_000,
    });
    this.from = config.get<string>(
      'MAIL_FROM',
      'ShopFast <no-reply@shopfast.local>',
    );
  }

  async send(message: MailMessage): Promise<{ messageId: string }> {
    const info = await this.transporter.sendMail({
      from: this.from,
      ...message,
    });
    return { messageId: info.messageId };
  }
}
