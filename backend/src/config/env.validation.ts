import * as Joi from 'joi';

/**
 * Kiểm tra biến môi trường ngay khi ứng dụng khởi động.
 * Thiếu hoặc sai biến quan trọng → ứng dụng dừng luôn với thông báo rõ ràng,
 * thay vì chạy được nửa chừng rồi lỗi khó hiểu.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),

  // ---------- Xác thực ----------
  // Bí mật ký access token: tối thiểu 32 ký tự để khó bị dò (brute-force).
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  // Thời hạn access token, định dạng của thư viện `ms`: 15m, 1h…
  JWT_ACCESS_EXPIRES_IN: Joi.string()
    .pattern(/^\d+[smhd]$/)
    .default('15m'),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().min(1).max(30).default(7),
  // Số vòng băm bcrypt. 12 cho production; test có thể hạ xuống 4 cho nhanh.
  BCRYPT_ROUNDS: Joi.number().integer().min(4).max(15).default(12),
  // Cookie chỉ gửi qua HTTPS. Mặc định: bật khi production, tắt khi dev (localhost là HTTP).
  COOKIE_SECURE: Joi.boolean().when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().default(true),
    otherwise: Joi.boolean().default(false),
  }),

  // ---------- Email (dev: Mailpit ở localhost:1025, xem thư tại http://localhost:8025) ----------
  // Dùng 127.0.0.1 thay vì localhost: Node có thể phân giải localhost ra IPv6 (::1)
  // trong khi docker-compose chỉ mở cổng trên IPv4 127.0.0.1.
  SMTP_HOST: Joi.string().hostname().default('127.0.0.1'),
  SMTP_PORT: Joi.number().port().default(1025),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().allow('').optional(),
  SMTP_PASS: Joi.string().allow('').optional(),
  MAIL_FROM: Joi.string().default('ShopFast <no-reply@shopfast.local>'),

  // ---------- Tác vụ nền ----------
  // Nhắc thanh toán sau bao lâu (ms). SRS: 30 phút. Demo có thể hạ xuống 60000 (1 phút).
  PAYMENT_REMINDER_DELAY_MS: Joi.number()
    .integer()
    .min(1000)
    .default(30 * 60 * 1000),
  // Báo cáo doanh thu hằng đêm — cron theo giờ Việt Nam. Mặc định 23:00 mỗi ngày.
  DAILY_REPORT_CRON: Joi.string().default('0 23 * * *'),
  // Tỉ lệ lỗi giả lập của API đối tác kho (0 → 1). Đặt 1 để demo retry + dead letter.
  PARTNER_SYNC_FAILURE_RATE: Joi.number().min(0).max(1).default(0),
});
