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
});
