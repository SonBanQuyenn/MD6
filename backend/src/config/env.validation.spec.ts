import { envValidationSchema } from './env.validation';

describe('envValidationSchema', () => {
  const valid = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/shopfast',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
  };

  it('chấp nhận cấu hình hợp lệ và điền giá trị mặc định', () => {
    const { error, value } = envValidationSchema.validate(valid);

    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      PORT: 3000,
      NODE_ENV: 'development',
      JWT_ACCESS_EXPIRES_IN: '15m',
      REFRESH_TOKEN_TTL_DAYS: 7,
      BCRYPT_ROUNDS: 12,
      COOKIE_SECURE: false,
    });
  });

  it('production → COOKIE_SECURE mặc định true', () => {
    const { value } = envValidationSchema.validate({
      ...valid,
      NODE_ENV: 'production',
    });

    expect(value.COOKIE_SECURE).toBe(true);
  });

  it('báo lỗi khi thiếu DATABASE_URL', () => {
    const { error } = envValidationSchema.validate({
      ...valid,
      DATABASE_URL: undefined,
    });

    expect(error?.message).toContain('DATABASE_URL');
  });

  it('báo lỗi khi REDIS_URL sai giao thức', () => {
    const { error } = envValidationSchema.validate({
      ...valid,
      REDIS_URL: 'http://localhost:6379',
    });

    expect(error?.message).toContain('REDIS_URL');
  });

  it('báo lỗi khi NODE_ENV không thuộc danh sách cho phép', () => {
    const { error } = envValidationSchema.validate({
      ...valid,
      NODE_ENV: 'staging',
    });

    expect(error?.message).toContain('NODE_ENV');
  });

  it('báo lỗi khi JWT_ACCESS_SECRET ngắn hơn 32 ký tự', () => {
    const { error } = envValidationSchema.validate({
      ...valid,
      JWT_ACCESS_SECRET: 'short',
    });

    expect(error?.message).toContain('JWT_ACCESS_SECRET');
  });

  it('báo lỗi khi JWT_ACCESS_EXPIRES_IN sai định dạng', () => {
    const { error } = envValidationSchema.validate({
      ...valid,
      JWT_ACCESS_EXPIRES_IN: '15 minutes',
    });

    expect(error?.message).toContain('JWT_ACCESS_EXPIRES_IN');
  });
});
