import { ConfigService } from '@nestjs/config';
import { MailerService } from '../mail/mailer.service';
import { PasswordService } from './password.service';

const sendMail = jest.fn().mockResolvedValue({ messageId: '<id@x>' });
const createTransport = jest.fn(() => ({ sendMail }));
jest.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) =>
    (createTransport as (...a: unknown[]) => unknown)(...args),
}));

const config = (values: Record<string, unknown>) =>
  ({
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  }) as unknown as ConfigService;

describe('PasswordService (bcrypt thật, 4 vòng cho nhanh)', () => {
  const service = new PasswordService(config({ BCRYPT_ROUNDS: 4 }));

  it('băm có salt ngẫu nhiên: cùng mật khẩu → 2 hash khác nhau, đều so khớp được', async () => {
    const a = await service.hash('Matkhau123');
    const b = await service.hash('Matkhau123');
    expect(a).not.toBe(b);
    expect(a).not.toContain('Matkhau123');
    await expect(service.compare('Matkhau123', a)).resolves.toBe(true);
    await expect(service.compare('SaiMatKhau', b)).resolves.toBe(false);
  });
});

describe('MailerService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('không có SMTP_USER (Mailpit) → không gửi auth; gửi thư kèm From và Message-ID', async () => {
    const mailer = new MailerService(config({ MAIL_FROM: 'ShopFast <a@b.c>' }));
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '127.0.0.1',
        port: 1025,
        auth: undefined,
      }),
    );
    await expect(
      mailer.send({
        to: 'k@x.com',
        subject: 'S',
        html: '<p>x</p>',
        messageId: '<m@x>',
      }),
    ).resolves.toEqual({ messageId: '<id@x>' });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'ShopFast <a@b.c>', messageId: '<m@x>' }),
    );
  });

  it('có SMTP_USER → dùng xác thực SMTP', () => {
    new MailerService(
      config({ SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_HOST: 'smtp.x' }),
    );
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.x',
        auth: { user: 'u', pass: 'p' },
      }),
    );
  });
});
