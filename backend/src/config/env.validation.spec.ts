import { envValidationSchema } from './env.validation';

describe('envValidationSchema', () => {
  const valid = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/shopfast',
    REDIS_URL: 'redis://localhost:6379',
  };

  it('chấp nhận cấu hình hợp lệ và điền giá trị mặc định', () => {
    const { error, value } = envValidationSchema.validate(valid);

    expect(error).toBeUndefined();
    expect(value.PORT).toBe(3000);
    expect(value.NODE_ENV).toBe('development');
  });

  it('báo lỗi khi thiếu DATABASE_URL', () => {
    const { error } = envValidationSchema.validate({
      REDIS_URL: valid.REDIS_URL,
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
});
