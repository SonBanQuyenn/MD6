import { EmailLog, EmailStatus } from '@prisma/client';
import { EmailLogsRepository } from './email-logs.repository';
import { EmailService } from './email.service';
import { MailerService } from './mailer.service';
import { escapeHtml, orderConfirmationEmail } from './templates';

const log = (status: EmailStatus): EmailLog => ({
  id: 'log1',
  dedupeKey: 'order-confirmation-o1',
  type: 'order-confirmation',
  orderId: 'o1',
  toEmail: 'k@example.com',
  subject: 's',
  status,
  attempts: 1,
  providerMessageId: null,
  lastError: null,
  sentAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('EmailService.sendOnce (mỗi dedupeKey chỉ gửi 1 lần)', () => {
  let logs: jest.Mocked<
    Pick<EmailLogsRepository, 'claim' | 'markSent' | 'markFailed'>
  >;
  let mailer: jest.Mocked<Pick<MailerService, 'send'>>;
  let service: EmailService;
  const input = {
    dedupeKey: 'order-confirmation-o1',
    type: 'order-confirmation',
    orderId: 'o1',
    to: 'k@example.com',
    subject: 'Xác nhận',
    html: '<p>x</p>',
  };

  beforeEach(() => {
    logs = {
      claim: jest.fn(),
      markSent: jest.fn(),
      markFailed: jest.fn(),
    };
    mailer = { send: jest.fn().mockResolvedValue({ messageId: 'm1' }) };
    service = new EmailService(
      logs as unknown as EmailLogsRepository,
      mailer as unknown as MailerService,
    );
  });

  it('lần đầu: gửi, dùng Message-ID cố định, đánh dấu SENT', async () => {
    logs.claim.mockResolvedValue({
      log: log(EmailStatus.SENDING),
      acquired: true,
    });

    await expect(service.sendOnce(input)).resolves.toBe('sent');

    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'k@example.com',
        messageId: '<order-confirmation-o1@shopfast.local>',
      }),
    );
    expect(logs.markSent).toHaveBeenCalledWith('log1', 'm1');
  });

  it('đã SENT trước đó (job chạy lại) → KHÔNG gửi lần 2', async () => {
    logs.claim.mockResolvedValue({
      log: log(EmailStatus.SENT),
      acquired: false,
    });

    await expect(service.sendOnce(input)).resolves.toBe('already-sent');
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('lần trước FAILED và giành lại được quyền gửi → gửi lại', async () => {
    logs.claim.mockResolvedValue({
      log: log(EmailStatus.SENDING),
      acquired: true,
    });

    await expect(service.sendOnce(input)).resolves.toBe('sent');
    expect(mailer.send).toHaveBeenCalledTimes(1);
  });

  it('worker khác đang gửi (không giành được quyền) → KHÔNG gửi, ném lỗi để retry sau', async () => {
    logs.claim.mockResolvedValue({
      log: log(EmailStatus.SENDING),
      acquired: false,
    });

    await expect(service.sendOnce(input)).rejects.toThrow('worker khác');
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('SMTP lỗi → đánh dấu FAILED và ném lỗi để BullMQ retry', async () => {
    logs.claim.mockResolvedValue({
      log: log(EmailStatus.SENDING),
      acquired: true,
    });
    mailer.send.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.sendOnce(input)).rejects.toThrow('ECONNREFUSED');
    expect(logs.markFailed).toHaveBeenCalledWith('log1', 'ECONNREFUSED');
    expect(logs.markSent).not.toHaveBeenCalled();
  });
});

describe('email templates', () => {
  it('escape HTML trong dữ liệu người dùng nhập', () => {
    expect(escapeHtml('<script>"x"</script>')).toBe(
      '&lt;script&gt;&quot;x&quot;&lt;/script&gt;',
    );
    const { html } = orderConfirmationEmail({
      code: 'SF-1',
      customerName: '<b>Hacker</b>',
      total: 1000,
      items: [{ productName: '<img src=x>', quantity: 1, unitPrice: 1000 }],
    });
    expect(html).not.toContain('<img src=x>');
    expect(html).not.toContain('<b>Hacker</b>');
  });
});
