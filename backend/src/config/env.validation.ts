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
});
